"""Telegram test helper: send/read messages to/from @mlh_clawd_bot"""
import asyncio, sys
from telethon import TelegramClient
from telethon.sessions import StringSession

S = "1ApWapzMBux28Sj1kx1xa-Qkc4DPtoYdF0KETmUPJMFnfkFl8SvAimzTQMc1hJSKKAbH-MPUq6MmN2kXdOCxml57M2ttMtJ2hSdTge4xxhtzuygGO8FkVjFTfeREh43JVqg7UbJdvuwb1Quxp1DDWgcKf12rMGFc5rww2zZ6wiqBIiMyw_WhloYZZ2qm2JndX2DjvBOZ8Kx_kOZTM2jxeYgNuOh1jUev4KTf2QtApng0n23bmaJWtup3MEBV0pl0fKigt28EYXY08hy9A8BDZM-xJ4bhhzL6F7-ABLYrIHkkzEtys7yuYnScTYY8Nc1q4DXDKsuQDnKNYv1ici1_IRtEmF0HCC9Q="
BOT = "mlh_clawd_bot"

async def main():
    c = TelegramClient(StringSession(S), 15153052, "0695062a8881222cf291fcfede909464")
    await c.start()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "read"
    if cmd == "send":
        msg = " ".join(sys.argv[2:]) or "test"
        r = await c.send_message(BOT, msg)
        print(f"sent:{r.id}")
    elif cmd == "read":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 8
        msgs = await c.get_messages(BOT, limit=n)
        for m in reversed(msgs):
            who = "BOT" if m.sender_id == 7576656740 else "YOU"
            print(f"[{who}] {(m.text or '(no text)')}")
    await c.disconnect()

asyncio.run(main())
