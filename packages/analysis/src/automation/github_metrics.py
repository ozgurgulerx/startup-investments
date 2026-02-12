"""
GitHub Temporal Metrics Collector.

Extends the existing GitHubClient to collect temporal metrics (stars, forks,
releases, issue velocity, PR velocity, contributor count, last commit) and
store snapshots as startup_events for signal evidence.
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import asyncpg
import httpx

from src.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_REPOS_PER_ORG = 10
GITHUB_API_BASE = "https://api.github.com"


# ---------------------------------------------------------------------------
# GitHub Temporal Client
# ---------------------------------------------------------------------------

class GitHubTemporalClient:
    """Collect temporal metrics from GitHub repos for a startup."""

    def __init__(self, token: Optional[str] = None):
        self.token = token or settings.crawler.github_token
        headers = {"Accept": "application/vnd.github.v3+json"}
        if self.token:
            headers["Authorization"] = f"token {self.token}"
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers=headers,
            base_url=GITHUB_API_BASE,
        )

    async def close(self):
        await self.client.aclose()

    async def _get(self, path: str, params: Optional[Dict] = None) -> Optional[Any]:
        """Safe GET request with error handling."""
        try:
            resp = await self.client.get(path, params=params or {})
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 403:
                logger.warning("GitHub rate limit hit for %s", path)
            return None
        except Exception as exc:
            logger.debug("GitHub API error for %s: %s", path, exc)
            return None

    async def _get_link_count(self, path: str, params: Optional[Dict] = None) -> int:
        """Use GitHub's Link header pagination to get total count efficiently."""
        try:
            p = {**(params or {}), "per_page": 1}
            resp = await self.client.get(path, params=p)
            if resp.status_code != 200:
                return 0
            link = resp.headers.get("Link", "")
            if 'rel="last"' in link:
                # Extract page number from last link
                for part in link.split(","):
                    if 'rel="last"' in part:
                        url_part = part.split(";")[0].strip(" <>")
                        for param in url_part.split("?")[1].split("&"):
                            if param.startswith("page="):
                                return int(param.split("=")[1])
            # No pagination means result fits in 1 page
            data = resp.json()
            return len(data) if isinstance(data, list) else 0
        except Exception:
            return 0

    async def collect_repo_metrics(self, owner: str, repo: str) -> Dict[str, Any]:
        """Collect temporal metrics for a single repo."""
        now = datetime.now(timezone.utc)
        thirty_days_ago = (now - timedelta(days=30)).isoformat()
        ninety_days_ago = (now - timedelta(days=90)).isoformat()

        # Fetch repo info (stars, forks, last push)
        repo_data = await self._get(f"/repos/{owner}/{repo}")
        if not repo_data:
            return {}

        metrics: Dict[str, Any] = {
            "repo": f"{owner}/{repo}",
            "stars_count": repo_data.get("stargazers_count", 0),
            "forks_count": repo_data.get("forks_count", 0),
            "open_issues_count": repo_data.get("open_issues_count", 0),
            "last_push_at": repo_data.get("pushed_at"),
        }

        # Releases in last 90 days
        releases = await self._get(
            f"/repos/{owner}/{repo}/releases",
            {"per_page": 100},
        )
        if releases:
            recent_releases = [
                r for r in releases
                if r.get("published_at") and r["published_at"] >= ninety_days_ago
            ]
            metrics["releases_90d"] = len(recent_releases)
        else:
            metrics["releases_90d"] = 0

        # Issue velocity (opened in last 30 days)
        metrics["issues_opened_30d"] = await self._get_link_count(
            f"/repos/{owner}/{repo}/issues",
            {"state": "all", "since": thirty_days_ago, "per_page": 1},
        )

        # PR velocity (opened + merged in last 30 days)
        # Use search API for more accuracy
        pr_search = await self._get(
            "/search/issues",
            {"q": f"repo:{owner}/{repo} is:pr created:>={thirty_days_ago[:10]}"},
        )
        metrics["prs_opened_30d"] = pr_search.get("total_count", 0) if pr_search else 0

        pr_merged = await self._get(
            "/search/issues",
            {"q": f"repo:{owner}/{repo} is:pr is:merged merged:>={thirty_days_ago[:10]}"},
        )
        metrics["prs_merged_30d"] = pr_merged.get("total_count", 0) if pr_merged else 0

        # Contributors in last 30 days (via commit authors)
        commits = await self._get(
            f"/repos/{owner}/{repo}/commits",
            {"since": thirty_days_ago, "per_page": 100},
        )
        if commits and isinstance(commits, list):
            unique_authors = set()
            last_commit_at = None
            for c in commits:
                author = c.get("author")
                if author and author.get("login"):
                    unique_authors.add(author["login"])
                if not last_commit_at and c.get("commit", {}).get("author", {}).get("date"):
                    last_commit_at = c["commit"]["author"]["date"]
            metrics["contributor_count_30d"] = len(unique_authors)
            metrics["last_commit_at"] = last_commit_at
        else:
            metrics["contributor_count_30d"] = 0
            metrics["last_commit_at"] = None

        metrics["collected_at"] = now.isoformat()
        return metrics

    async def collect_org_metrics(self, org: str) -> Dict[str, Any]:
        """Collect aggregate temporal metrics across an org's top repos."""
        repos_data = await self._get(
            f"/orgs/{org}/repos",
            {"sort": "pushed", "per_page": MAX_REPOS_PER_ORG, "type": "public"},
        )
        if not repos_data:
            # Try as user
            repos_data = await self._get(
                f"/users/{org}/repos",
                {"sort": "pushed", "per_page": MAX_REPOS_PER_ORG, "type": "public"},
            )
        if not repos_data:
            return {}

        all_metrics: List[Dict[str, Any]] = []
        for repo_info in repos_data[:MAX_REPOS_PER_ORG]:
            repo_name = repo_info.get("name", "")
            if repo_info.get("fork"):
                continue
            m = await self.collect_repo_metrics(org, repo_name)
            if m:
                all_metrics.append(m)

        if not all_metrics:
            return {}

        # Aggregate across repos
        aggregate = {
            "org": org,
            "repo_count": len(all_metrics),
            "total_stars": sum(m.get("stars_count", 0) for m in all_metrics),
            "total_forks": sum(m.get("forks_count", 0) for m in all_metrics),
            "total_releases_90d": sum(m.get("releases_90d", 0) for m in all_metrics),
            "total_issues_opened_30d": sum(m.get("issues_opened_30d", 0) for m in all_metrics),
            "total_prs_opened_30d": sum(m.get("prs_opened_30d", 0) for m in all_metrics),
            "total_prs_merged_30d": sum(m.get("prs_merged_30d", 0) for m in all_metrics),
            "total_contributors_30d": sum(m.get("contributor_count_30d", 0) for m in all_metrics),
            "repos": all_metrics,
            "collected_at": datetime.now(timezone.utc).isoformat(),
        }

        # Find most recent commit across all repos
        last_commits = [m["last_commit_at"] for m in all_metrics if m.get("last_commit_at")]
        if last_commits:
            aggregate["last_commit_at"] = max(last_commits)

        return aggregate


# ---------------------------------------------------------------------------
# Database integration
# ---------------------------------------------------------------------------

async def collect_github_metrics(
    conn: asyncpg.Connection,
    startup_id: str,
    github_org: str,
) -> Optional[Dict[str, Any]]:
    """Collect GitHub temporal metrics for a startup and store as a startup_event.

    Returns the metrics dict if successful, None otherwise.
    """
    client = GitHubTemporalClient()
    try:
        metrics = await client.collect_org_metrics(github_org)
        if not metrics:
            logger.info("No GitHub metrics found for org=%s (startup=%s)", github_org, startup_id[:8])
            return None

        # Store as startup_event
        await conn.execute(
            """INSERT INTO startup_events
               (startup_id, event_type, source_type, title, description, metadata_json, region)
               VALUES ($1::uuid, 'github_metrics', 'github', $2, $3, $4::jsonb, 'global')""",
            startup_id,
            f"GitHub metrics snapshot for {github_org}",
            f"Stars: {metrics['total_stars']}, Forks: {metrics['total_forks']}, "
            f"Contributors (30d): {metrics['total_contributors_30d']}",
            json.dumps(metrics),
        )

        logger.info(
            "Stored GitHub metrics for %s: stars=%d, forks=%d, contributors_30d=%d",
            github_org, metrics["total_stars"], metrics["total_forks"],
            metrics["total_contributors_30d"],
        )
        return metrics
    except Exception as exc:
        logger.error("Failed to collect GitHub metrics for %s: %s", github_org, exc)
        return None
    finally:
        await client.close()


async def compute_github_deltas(
    conn: asyncpg.Connection,
    startup_id: str,
) -> Optional[Dict[str, Any]]:
    """Compare current and previous GitHub metrics snapshots to compute deltas.

    Returns a dict with delta fields if two snapshots exist, None otherwise.
    """
    rows = await conn.fetch(
        """SELECT metadata_json FROM startup_events
           WHERE startup_id = $1::uuid AND event_type = 'github_metrics'
           ORDER BY detected_at DESC LIMIT 2""",
        startup_id,
    )
    if len(rows) < 2:
        return None

    current = rows[0]["metadata_json"] if isinstance(rows[0]["metadata_json"], dict) else json.loads(rows[0]["metadata_json"])
    previous = rows[1]["metadata_json"] if isinstance(rows[1]["metadata_json"], dict) else json.loads(rows[1]["metadata_json"])

    deltas = {
        "stars_delta": current.get("total_stars", 0) - previous.get("total_stars", 0),
        "forks_delta": current.get("total_forks", 0) - previous.get("total_forks", 0),
        "releases_90d_delta": current.get("total_releases_90d", 0) - previous.get("total_releases_90d", 0),
        "issues_delta": current.get("total_issues_opened_30d", 0) - previous.get("total_issues_opened_30d", 0),
        "prs_delta": current.get("total_prs_opened_30d", 0) - previous.get("total_prs_opened_30d", 0),
        "contributors_delta": current.get("total_contributors_30d", 0) - previous.get("total_contributors_30d", 0),
    }

    logger.debug("GitHub deltas for startup %s: %s", startup_id[:8], deltas)
    return deltas


# ---------------------------------------------------------------------------
# Batch runner (for cron / CLI)
# ---------------------------------------------------------------------------

async def run_github_metrics_collection(
    startup_id: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    """Collect GitHub metrics for startups that have github_url set.

    Args:
        startup_id: Optional specific startup to collect for.
        limit: Max number of startups to process in one run.

    Returns:
        Stats dict with counts.
    """
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = await asyncpg.connect(database_url)
    stats = {"processed": 0, "collected": 0, "errors": 0}

    try:
        if startup_id:
            rows = await conn.fetch(
                """SELECT id::text, name, github_url FROM startups
                   WHERE id = $1::uuid AND github_url IS NOT NULL""",
                startup_id,
            )
        else:
            # Get startups with github URLs that haven't been collected recently
            rows = await conn.fetch(
                """SELECT s.id::text, s.name, s.github_url
                   FROM startups s
                   WHERE s.github_url IS NOT NULL AND s.github_url != ''
                     AND NOT EXISTS (
                       SELECT 1 FROM startup_events se
                       WHERE se.startup_id = s.id
                         AND se.event_type = 'github_metrics'
                         AND se.detected_at > NOW() - INTERVAL '7 days'
                     )
                   ORDER BY RANDOM()
                   LIMIT $1""",
                limit,
            )

        for row in rows:
            stats["processed"] += 1
            github_url = row["github_url"]
            # Extract org from URL (e.g., https://github.com/orgname)
            org = _extract_github_org(github_url)
            if not org:
                logger.debug("Could not extract org from %s", github_url)
                continue

            result = await collect_github_metrics(conn, row["id"], org)
            if result:
                stats["collected"] += 1
            else:
                stats["errors"] += 1

    finally:
        await conn.close()

    logger.info("GitHub metrics collection complete: %s", stats)
    return stats


def _extract_github_org(url: str) -> Optional[str]:
    """Extract GitHub org/user name from a GitHub URL."""
    if not url:
        return None
    url = url.rstrip("/")
    # Handle various formats: https://github.com/org, github.com/org, etc.
    parts = url.replace("https://", "").replace("http://", "").split("/")
    if len(parts) >= 2 and "github.com" in parts[0]:
        return parts[1]
    return None
