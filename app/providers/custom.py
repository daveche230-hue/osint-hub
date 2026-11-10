import httpx
from bs4 import BeautifulSoup


async def get_mac_vendor(mac: str) -> dict:
    """Определение производителя (вендора) по MAC-адресу."""
    async with httpx.AsyncClient(timeout=8.0) as client:
        try:
            r = await client.get(f"https://api.macvendors.com/{mac}")
            if r.status_code == 200:
                return {"mac": mac, "vendor": r.text.strip()}
            return {"mac": mac, "vendor": "Vendor not found"}
        except Exception as e:
            return {"error": f"Failed to fetch MAC vendor: {str(e)}"}


async def check_blockchain(address: str) -> dict:
    """Парсинг основной информации по Bitcoin-адресу с blockchain.info."""
    url = f"https://blockchain.info/address/{address}"
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        try:
            r = await client.get(url)
            if r.status_code != 200:
                return {"error": "Address not found or page unreachable"}

            soup = BeautifulSoup(r.text, "html.parser")
            # Извлекаем тексты из таблиц и ключевых элементов страницы
            details = [
                el.get_text(strip=True)
                for el in soup.select("td, span.val")
                if el.get_text(strip=True)
            ]
            return {
                "address": address,
                "url": url,
                "summary": details[:10] if details else ["No data extracted"],
            }
        except Exception as e:
            return {"error": f"Parsing failed: {str(e)}"}


async def proxy_nova_search(query: str) -> dict:
    """Поиск компрометированных данных / прокси через ProxyNova COMB."""
    url = "https://api.proxynova.com/comb"
    async with httpx.AsyncClient(timeout=8.0) as client:
        try:
            r = await client.get(url, params={"query": query, "limit": 10})
            if r.status_code == 200:
                return r.json()
            return {"status": r.status_code, "results": []}
        except Exception as e:
            return {"error": str(e)}


async def check_social_profiles(username: str) -> dict:
    """Проверка наличия аккаунтов по никнейму в TikTok, Roblox и др."""
    results = {}
    async with httpx.AsyncClient(
        timeout=8.0, follow_redirects=True
    ) as client:
        # TikTok
        try:
            r = await client.get(
                f"https://www.tiktok.com/@{username}?lang=ru"
            )
            results["tiktok"] = {
                "url": f"https://www.tiktok.com/@{username}",
                "exists": r.status_code == 200,
            }
        except Exception:
            results["tiktok"] = {"exists": False}

        # Roblox
        try:
            r = await client.get(
                "https://users.roblox.com/v1/usernames/users",
                params={"username": username},
            )
            if r.status_code == 200 and r.json().get("data"):
                results["roblox"] = r.json()["data"][0]
            else:
                results["roblox"] = "Not found"
        except Exception:
            results["roblox"] = "Error"

    return results


async def get_phone_messenger_links(phone: str) -> dict:
    """Формирование прямых ссылок для быстрой проверки номера в мессенджерах."""
    clean_phone = "".join(filter(str.isdigit, phone))
    return {
        "whatsapp": f"https://wa.me/{clean_phone}",
        "telegram": f"https://t.me/+{clean_phone}",
        "ok_recovery": f"https://www.ok.ru/dk?st.cmd=anonymMain&st.accRecovery=on&st.email={clean_phone}",
    }
