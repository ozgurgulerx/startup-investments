import asyncio

from src.automation.newsletter_email import _load_monthly_subscriber_emails


class FakeConn:
    def __init__(self) -> None:
        self.query = ""

    async def fetch(self, query: str):
        self.query = query
        return [
            {"email": "alpha@example.com"},
            {"email": "beta@example.com"},
        ]


def test_load_monthly_subscriber_emails_uses_news_subscription_contract():
    conn = FakeConn()

    emails = asyncio.run(_load_monthly_subscriber_emails(conn))

    assert emails == ["alpha@example.com", "beta@example.com"]
    normalized = " ".join(conn.query.split())
    assert "FROM news_email_subscriptions" in normalized
    assert "digest_frequency = 'monthly'" in normalized
    assert "status = 'active'" in normalized
    assert "region = 'global'" in normalized
