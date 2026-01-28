import asyncio
import aiohttp

async def get_address():
    async with aiohttp.ClientSession() as session:
        # Try to get profile by username
        url = 'https://gamma-api.polymarket.com/public-profile'
        async with session.get(url, params={'username': 'yehuangz'}) as r:
            if r.status == 200:
                data = await r.json()
                print(f"Address: {data.get('proxyWallet') or data.get('address')}")
                print(f"Name: {data.get('name')}")
            else:
                print(f"Status: {r.status}")
                text = await r.text()
                print(text)

asyncio.run(get_address())
