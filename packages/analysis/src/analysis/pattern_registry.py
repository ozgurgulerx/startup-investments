"""Pattern Registry for tracking dynamically discovered build patterns.

This module provides functionality to:
- Register newly discovered patterns from startup analyses
- Track pattern occurrence counts and novelty scores
- Surface emerging patterns that appear across multiple startups
- Support pattern evolution tracking over time
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set
from datetime import datetime
import json
from pathlib import Path


@dataclass
class RegisteredPattern:
    """A pattern registered in the pattern registry."""
    pattern_name: str
    category: str
    first_seen_period: str
    last_seen_period: str
    occurrence_count: int = 1
    total_novelty_score: float = 0.0  # Sum of all novelty scores
    avg_novelty_score: float = 0.0
    is_canonical: bool = False  # True if in the standard BUILD_PATTERNS list
    description: str = ""
    startups: Set[str] = field(default_factory=set)  # Slugs of startups with this pattern
    evidence_samples: List[str] = field(default_factory=list)  # Sample evidence quotes


@dataclass
class PatternStats:
    """Statistics about a pattern's occurrence."""
    count: int
    total_funding: float
    startups: Set[str]
    avg_novelty: float


class PatternRegistry:
    """Registry for tracking discovered build patterns across analyses.

    This class manages a registry of all patterns discovered during startup
    analysis, allowing us to track which patterns are emerging vs. established,
    and surface novel architectural approaches that appear across multiple startups.
    """

    # Canonical patterns from the standard list (for reference)
    CANONICAL_PATTERNS = {
        'Agentic Architectures',
        'Vertical Data Moats',
        'Micro-model Meshes',
        'Continuous-learning Flywheels',
        'RAG (Retrieval-Augmented Generation)',
        'Knowledge Graphs',
        'Natural-Language-to-Code',
        'Guardrail-as-LLM',
        'Fine-tuned Models',
        'Compound AI Systems',
        'EvalOps',
        'LLMOps',
        'LLM Security',
        'Inference Optimization',
        'Data Flywheels',
        'Model Routing',
        'Prompt Engineering',
        'Hybrid Search',
        'Active Learning',
        'Synthetic Data Generation',
    }

    # Pattern categories
    CATEGORIES = [
        'Model Architecture',
        'Compound AI Systems',
        'Retrieval & Knowledge',
        'Evaluation & Quality',
        'Operations & Infrastructure',
        'Safety & Trust',
        'Learning & Improvement',
        'Data Strategy',
    ]

    def __init__(self, registry_path: Optional[Path] = None):
        """Initialize the pattern registry.

        Args:
            registry_path: Path to persist the registry. If None, uses in-memory only.
        """
        self.registry_path = registry_path
        self.patterns: Dict[str, RegisteredPattern] = {}

        if registry_path and registry_path.exists():
            self._load_registry()

    def _load_registry(self) -> None:
        """Load registry from file."""
        if not self.registry_path:
            return

        try:
            with open(self.registry_path, 'r') as f:
                data = json.load(f)

            for pattern_data in data.get('patterns', []):
                pattern = RegisteredPattern(
                    pattern_name=pattern_data['pattern_name'],
                    category=pattern_data['category'],
                    first_seen_period=pattern_data['first_seen_period'],
                    last_seen_period=pattern_data['last_seen_period'],
                    occurrence_count=pattern_data['occurrence_count'],
                    total_novelty_score=pattern_data.get('total_novelty_score', 0),
                    avg_novelty_score=pattern_data.get('avg_novelty_score', 0),
                    is_canonical=pattern_data.get('is_canonical', False),
                    description=pattern_data.get('description', ''),
                    startups=set(pattern_data.get('startups', [])),
                    evidence_samples=pattern_data.get('evidence_samples', []),
                )
                self.patterns[pattern.pattern_name.lower()] = pattern
        except Exception as e:
            print(f"Error loading pattern registry: {e}")

    def _save_registry(self) -> None:
        """Save registry to file."""
        if not self.registry_path:
            return

        data = {
            'updated_at': datetime.utcnow().isoformat(),
            'total_patterns': len(self.patterns),
            'patterns': [
                {
                    'pattern_name': p.pattern_name,
                    'category': p.category,
                    'first_seen_period': p.first_seen_period,
                    'last_seen_period': p.last_seen_period,
                    'occurrence_count': p.occurrence_count,
                    'total_novelty_score': p.total_novelty_score,
                    'avg_novelty_score': p.avg_novelty_score,
                    'is_canonical': p.is_canonical,
                    'description': p.description,
                    'startups': list(p.startups),
                    'evidence_samples': p.evidence_samples[:10],  # Keep only 10 samples
                }
                for p in self.patterns.values()
            ]
        }

        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.registry_path, 'w') as f:
            json.dump(data, f, indent=2)

    def register_pattern(
        self,
        pattern_name: str,
        category: str,
        startup_slug: str,
        period: str,
        novelty_score: int = 5,
        description: str = "",
        evidence: Optional[List[str]] = None,
    ) -> RegisteredPattern:
        """Register a discovered pattern or update if exists.

        Args:
            pattern_name: Name of the pattern
            category: Pattern category (one of CATEGORIES)
            startup_slug: Slug of the startup where pattern was found
            period: Analysis period (e.g., "2026-01")
            novelty_score: Novelty score 1-10
            description: Description of how pattern is implemented
            evidence: Evidence quotes supporting the pattern

        Returns:
            The registered or updated pattern
        """
        key = pattern_name.lower()

        if key in self.patterns:
            # Update existing pattern
            pattern = self.patterns[key]
            pattern.occurrence_count += 1
            pattern.total_novelty_score += novelty_score
            pattern.avg_novelty_score = pattern.total_novelty_score / pattern.occurrence_count
            pattern.last_seen_period = period
            pattern.startups.add(startup_slug)

            if evidence:
                # Add new evidence samples (keep max 10)
                for e in evidence[:2]:  # Add up to 2 new samples
                    if e not in pattern.evidence_samples:
                        pattern.evidence_samples.append(e)
                pattern.evidence_samples = pattern.evidence_samples[:10]
        else:
            # Create new pattern
            pattern = RegisteredPattern(
                pattern_name=pattern_name,
                category=category,
                first_seen_period=period,
                last_seen_period=period,
                occurrence_count=1,
                total_novelty_score=novelty_score,
                avg_novelty_score=novelty_score,
                is_canonical=pattern_name in self.CANONICAL_PATTERNS,
                description=description,
                startups={startup_slug},
                evidence_samples=evidence[:5] if evidence else [],
            )
            self.patterns[key] = pattern

        self._save_registry()
        return pattern

    def register_patterns_from_analysis(
        self,
        discovered_patterns: List[Dict],
        startup_slug: str,
        period: str,
    ) -> List[RegisteredPattern]:
        """Register multiple patterns from a startup analysis.

        Args:
            discovered_patterns: List of pattern dicts from PATTERN_DISCOVERY_PROMPT
            startup_slug: Slug of the startup
            period: Analysis period

        Returns:
            List of registered patterns
        """
        registered = []

        for p in discovered_patterns:
            pattern = self.register_pattern(
                pattern_name=p.get('pattern_name', ''),
                category=p.get('category', 'Other'),
                startup_slug=startup_slug,
                period=period,
                novelty_score=p.get('novelty_score', 5),
                description=p.get('description', ''),
                evidence=p.get('evidence', []),
            )
            registered.append(pattern)

        return registered

    def get_emerging_patterns(self, min_occurrences: int = 3) -> List[RegisteredPattern]:
        """Get patterns that are emerging (multiple occurrences, not canonical).

        Args:
            min_occurrences: Minimum occurrences to be considered emerging

        Returns:
            List of emerging patterns sorted by occurrence count
        """
        emerging = [
            p for p in self.patterns.values()
            if p.occurrence_count >= min_occurrences and not p.is_canonical
        ]
        return sorted(emerging, key=lambda x: x.occurrence_count, reverse=True)

    def get_novel_patterns(self, min_novelty: float = 7.0) -> List[RegisteredPattern]:
        """Get patterns with high average novelty scores.

        Args:
            min_novelty: Minimum average novelty score

        Returns:
            List of novel patterns sorted by novelty score
        """
        novel = [
            p for p in self.patterns.values()
            if p.avg_novelty_score >= min_novelty
        ]
        return sorted(novel, key=lambda x: x.avg_novelty_score, reverse=True)

    def get_patterns_by_category(self, category: str) -> List[RegisteredPattern]:
        """Get all patterns in a category.

        Args:
            category: Pattern category

        Returns:
            List of patterns in the category
        """
        return [
            p for p in self.patterns.values()
            if p.category == category
        ]

    def get_pattern_stats(self) -> Dict[str, int]:
        """Get statistics about registered patterns.

        Returns:
            Dict with pattern statistics
        """
        canonical = sum(1 for p in self.patterns.values() if p.is_canonical)
        non_canonical = len(self.patterns) - canonical

        return {
            'total_patterns': len(self.patterns),
            'canonical_patterns': canonical,
            'discovered_patterns': non_canonical,
            'total_occurrences': sum(p.occurrence_count for p in self.patterns.values()),
            'emerging_count': len(self.get_emerging_patterns()),
            'high_novelty_count': len(self.get_novel_patterns()),
            'categories_used': len(set(p.category for p in self.patterns.values())),
        }

    def get_pattern_evolution(self, pattern_name: str) -> Optional[Dict]:
        """Get evolution data for a pattern over time.

        Args:
            pattern_name: Name of the pattern

        Returns:
            Dict with evolution data or None if pattern not found
        """
        key = pattern_name.lower()
        if key not in self.patterns:
            return None

        pattern = self.patterns[key]
        return {
            'pattern_name': pattern.pattern_name,
            'first_seen': pattern.first_seen_period,
            'last_seen': pattern.last_seen_period,
            'total_occurrences': pattern.occurrence_count,
            'startups': list(pattern.startups),
            'avg_novelty': pattern.avg_novelty_score,
            'is_canonical': pattern.is_canonical,
        }

    def promote_to_canonical(self, pattern_name: str) -> bool:
        """Promote a pattern to canonical status.

        This should be called when a pattern has enough occurrences
        to be considered a standard pattern.

        Args:
            pattern_name: Name of the pattern to promote

        Returns:
            True if pattern was promoted, False if not found
        """
        key = pattern_name.lower()
        if key not in self.patterns:
            return False

        self.patterns[key].is_canonical = True
        self._save_registry()
        return True

    def get_newsletter_highlights(self, period: str) -> Dict:
        """Get pattern highlights for newsletter generation.

        Args:
            period: Current analysis period

        Returns:
            Dict with newsletter-ready pattern highlights
        """
        # Get patterns from current period
        current_patterns = [
            p for p in self.patterns.values()
            if p.last_seen_period == period
        ]

        # Sort by various criteria
        by_novelty = sorted(current_patterns, key=lambda x: x.avg_novelty_score, reverse=True)
        by_count = sorted(current_patterns, key=lambda x: x.occurrence_count, reverse=True)

        # Find newly discovered (first seen this period)
        newly_discovered = [
            p for p in current_patterns
            if p.first_seen_period == period and not p.is_canonical
        ]

        return {
            'period': period,
            'total_patterns_this_period': len(current_patterns),
            'newly_discovered': [
                {
                    'name': p.pattern_name,
                    'category': p.category,
                    'novelty_score': p.avg_novelty_score,
                    'startups': list(p.startups)[:5],
                    'description': p.description,
                }
                for p in newly_discovered[:5]
            ],
            'most_novel': [
                {
                    'name': p.pattern_name,
                    'category': p.category,
                    'novelty_score': p.avg_novelty_score,
                    'why_notable': p.evidence_samples[0] if p.evidence_samples else '',
                }
                for p in by_novelty[:5]
            ],
            'most_common': [
                {
                    'name': p.pattern_name,
                    'category': p.category,
                    'count': p.occurrence_count,
                    'is_canonical': p.is_canonical,
                }
                for p in by_count[:5]
            ],
            'category_distribution': {
                cat: len([p for p in current_patterns if p.category == cat])
                for cat in self.CATEGORIES
            },
        }
