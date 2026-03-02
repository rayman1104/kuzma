import type { Api } from "grammy";
import type { TopicRepo, ForumChatRepo, TopicProjectRepo } from "../../db/client";
import { createForumTopic } from "../handlers/forum";
import type { RouteHandler } from "../bridge";

async function parseBody(req: Request): Promise<any> {
  const text = await req.text();
  if (!text) throw new Error("Empty request body");
  return JSON.parse(text);
}

export function createForumRoutes(
  api: Api, topicRepo: TopicRepo, forumChats: ForumChatRepo,
  topicProjects?: TopicProjectRepo,
): RouteHandler {
  return async (req, url) => {
    if (!url.pathname.startsWith("/forum")) return null;

    const forumChatId = forumChats.allIds()[0];

    if (req.method === "POST" && url.pathname === "/forum/create-topic") {
      if (!forumChatId) return Response.json({ error: "No forum group registered" }, { status: 400 });
      const { name } = (await parseBody(req)) as { name: string };
      if (!name) return Response.json({ error: "name is required" }, { status: 400 });
      try {
        const threadId = await createForumTopic(api, topicRepo, forumChatId, name);
        return Response.json({ ok: true, threadId, chatId: forumChatId, name });
      } catch (err: any) {
        return Response.json({ error: err.message || String(err) }, { status: 500 });
      }
    }

    if (req.method === "GET" && url.pathname === "/forum/topics") {
      if (!forumChatId) return Response.json({ topics: [], chatId: null });
      const topics = topicRepo.all(forumChatId);
      return Response.json({ topics, chatId: forumChatId });
    }

    if (req.method === "POST" && url.pathname === "/forum/send") {
      if (!forumChatId) return Response.json({ error: "No forum group registered" }, { status: 400 });
      const { topic, text } = (await parseBody(req)) as { topic: string; text: string };
      if (!topic || !text) return Response.json({ error: "topic and text required" }, { status: 400 });
      const threadId = topicRepo.getThreadId(topic.toLowerCase(), forumChatId);
      if (!threadId) return Response.json({ error: `Topic "${topic}" not found` }, { status: 404 });
      try {
        const opts: any = {};
        if (threadId !== 1) opts.message_thread_id = threadId;
        await api.sendMessage(forumChatId, text, opts);
        return Response.json({ ok: true, threadId });
      } catch (err: any) {
        return Response.json({ error: err.message || String(err) }, { status: 500 });
      }
    }

    if (req.method === "POST" && url.pathname === "/forum/set-project") {
      if (!forumChatId) return Response.json({ error: "No forum group registered" }, { status: 400 });
      if (!topicProjects) return Response.json({ error: "Topic projects not configured" }, { status: 500 });
      const { topic, path } = (await parseBody(req)) as { topic: string; path: string };
      if (!topic || !path) return Response.json({ error: "topic and path required" }, { status: 400 });
      const threadId = topicRepo.getThreadId(topic.toLowerCase(), forumChatId);
      if (!threadId) return Response.json({ error: `Topic "${topic}" not found` }, { status: 404 });
      topicProjects.set(threadId, forumChatId, path);
      return Response.json({ ok: true, threadId });
    }

    if (req.method === "GET" && url.pathname === "/forum/project") {
      if (!forumChatId) return Response.json({ error: "No forum group registered" }, { status: 400 });
      if (!topicProjects) return Response.json({ error: "Topic projects not configured" }, { status: 500 });
      const topic = url.searchParams.get("topic");
      if (!topic) return Response.json({ error: "topic query param required" }, { status: 400 });
      const threadId = topicRepo.getThreadId(topic.toLowerCase(), forumChatId);
      if (!threadId) return Response.json({ error: `Topic "${topic}" not found` }, { status: 404 });
      const path = topicProjects.get(threadId, forumChatId);
      return Response.json({ topic, path });
    }

    return null;
  };
}
