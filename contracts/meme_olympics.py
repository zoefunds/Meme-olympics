# v0.2.17
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
import re
from dataclasses import dataclass

from genlayer import *

# ----------------------------------------------------------------------------
# Error classification prefixes.
#
# Validators use these to decide how to compare failures:
#   EXPECTED  — deterministic business-logic failures; exact match required
#   EXTERNAL  — external API 4xx-style failures; exact match required
#   TRANSIENT — network/5xx flakiness; validators agree if both are transient
#   LLM       — LLM misbehaviour; validators always disagree, forcing leader
#               rotation instead of locking bad state on-chain
# ----------------------------------------------------------------------------
ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

# ----------------------------------------------------------------------------
# Domain constants — statuses stored as plain strings (Enums are not
# persistable in GenLayer storage).
# ----------------------------------------------------------------------------
COMP_STATUS_CREATED = "created"
COMP_STATUS_OPEN = "open"
COMP_STATUS_JUDGING = "judging"
COMP_STATUS_FINALIZED = "finalized"
COMP_STATUS_CANCELLED = "cancelled"

SUB_STATUS_PENDING = "pending"
SUB_STATUS_EVALUATED = "evaluated"
SUB_STATUS_REJECTED = "rejected"
SUB_STATUS_DISQUALIFIED = "disqualified"
SUB_STATUS_WINNER = "winner"

DISPUTE_STATUS_OPEN = "open"
DISPUTE_STATUS_UPHELD = "upheld"
DISPUTE_STATUS_REJECTED = "rejected"

PLAGIARISM_ORIGINAL = "original"
PLAGIARISM_SUSPICIOUS = "suspicious"
PLAGIARISM_COPIED = "copied"

# The nine judging criteria, in canonical order. Weights are configurable
# on-chain (basis points, sum == 10000) but the criteria set is fixed so
# leader and validators always score the same dimensions.
CRITERIA = [
    "originality",
    "humor",
    "relevance",
    "timing",
    "irony",
    "cultural_awareness",
    "crypto_native_understanding",
    "contextual_intelligence",
    "creativity",
]

# Default criterion weights in basis points (sum = 10000).
DEFAULT_WEIGHTS_BP = {
    "originality": 1600,
    "humor": 1600,
    "relevance": 1200,
    "timing": 900,
    "irony": 800,
    "cultural_awareness": 1000,
    "crypto_native_understanding": 1400,
    "contextual_intelligence": 700,
    "creativity": 800,
}

# Consensus tolerances — deliberately generous so honest validators with
# slightly different LLM outputs still agree, avoiding unnecessary leader
# rotation, while dishonest/broken leaders still get caught.
SCORE_TOLERANCE = 15          # total score points out of 100
CRITERION_TOLERANCE = 5       # per-criterion points out of 10
CONFIDENCE_TOLERANCE = 35     # plagiarism confidence, out of 100

# Hard limits (anti-gaming / compute-bound safety).
MAX_TITLE_LEN = 120
MAX_CAPTION_LEN = 600
MAX_URL_LEN = 500
MAX_TAGS = 8
MAX_TAG_LEN = 32
MAX_SUBMISSIONS_PER_COMPETITION = 200
MAX_DISPUTE_REASON_LEN = 1000

ATTO = 10**18  # reward points are stored atto-scaled, standard cross-chain


# ----------------------------------------------------------------------------
# Storage dataclasses.
#
# Only str / u256 / bool fields are used inside dataclasses; any list-like
# or nested structure is serialized to a JSON string. This keeps the storage
# layout simple, upgrade-safe (append-only), and avoids nested-container
# pitfalls. New fields must only ever be APPENDED at the end.
# ----------------------------------------------------------------------------
@allow_storage
@dataclass
class Competition:
    id: str
    title: str
    theme: str
    status: str
    starts_at: str            # ISO-8601 string
    ends_at: str              # ISO-8601 string
    prize_pool_atto: u256     # total reward points for this competition
    winner_count: u256
    submission_count: u256
    created_by: str           # hex address of creator
    created_at: str
    finalized_at: str
    winners_json: str         # JSON: [{submission_id, rank, reward_atto}]


@allow_storage
@dataclass
class Submission:
    id: str
    competition_id: str
    author: str               # hex address of submitting wallet
    title: str
    caption: str
    image_url: str
    context_url: str          # optional supporting link ("why this is timely")
    tags_json: str            # JSON array of strings
    status: str
    submitted_at: str
    # Evaluation results (zero/empty until evaluated)
    total_score: u256         # 0..100
    criteria_json: str        # JSON: {criterion: 0..10}
    plagiarism_verdict: str   # original | suspicious | copied | ""
    plagiarism_confidence: u256  # 0..100
    image_accessible: bool
    evaluation_summary: str
    evaluated_at: str


@allow_storage
@dataclass
class Dispute:
    id: str
    submission_id: str
    competition_id: str
    opened_by: str
    reason: str
    evidence_url: str
    status: str
    verdict_summary: str
    opened_at: str
    resolved_at: str


@allow_storage
@dataclass
class UserStats:
    address: str
    submissions: u256
    wins: u256
    total_score_accum: u256
    rewards_atto: u256
    disqualifications: u256
    last_submission_at: str


class MemeOlympics(gl.Contract):
    """Weekly AI-judged crypto meme competitions with validator consensus."""

    # ------------------------------------------------------------------
    # Storage layout — append-only. Never reorder or insert fields.
    # ------------------------------------------------------------------
    owner: Address
    admins: TreeMap[str, bool]
    paused: bool

    # Configuration
    weights_json: str                       # JSON {criterion: weight_bp}
    default_winner_count: u256
    min_seconds_between_submissions: u256   # advisory, enforced off-chain
    max_submissions_per_user: u256          # per competition

    # Competitions
    competitions: TreeMap[str, Competition]
    competition_ids: DynArray[str]
    active_competition_id: str

    # Submissions
    submissions: TreeMap[str, Submission]
    submission_ids: DynArray[str]
    competition_submissions_json: TreeMap[str, str]   # comp_id -> JSON [sub_id]
    user_comp_submission_count: TreeMap[str, u256]    # f"{comp_id}:{addr}" -> n
    image_url_seen: TreeMap[str, str]                 # normalized url -> sub_id

    # Disputes
    disputes: TreeMap[str, Dispute]
    dispute_ids: DynArray[str]
    submission_dispute_count: TreeMap[str, u256]

    # Rewards & users — reward_balances_atto is REAL, CLAIMABLE GEN (native
    # token), escrowed in this contract's own balance. It is funded only by
    # actual `value` sent to create_competition/fund_competition, and paid
    # out only by claim_reward's on-chain transfer. It is not an internal
    # points ledger.
    user_stats: TreeMap[str, UserStats]
    reward_balances_atto: TreeMap[str, u256]
    total_rewards_distributed_atto: u256    # allocated to winners at finalize
    total_rewards_claimed_atto: u256        # actually transferred out via claim_reward

    # Counters / audit
    total_competitions: u256
    total_submissions: u256
    total_evaluations: u256
    total_disputes: u256
    audit_log: DynArray[str]                # JSON event strings, capped reads

    # ==================================================================
    # Constructor
    # ==================================================================
    def __init__(self, owner_address: str = ""):
        # Some deployment paths (RPC vs Studio UI) present a zero sender to
        # the constructor, so an explicit owner may be passed; it falls back
        # to the deploying sender when omitted.
        if owner_address:
            self.owner = Address(owner_address)
        else:
            self.owner = gl.message.sender_address
        self.paused = False
        self.admins[self._addr_str(self.owner)] = True

        self.weights_json = json.dumps(DEFAULT_WEIGHTS_BP, sort_keys=True)
        self.default_winner_count = u256(3)
        self.min_seconds_between_submissions = u256(60)
        self.max_submissions_per_user = u256(3)

        self.active_competition_id = ""
        self.total_rewards_distributed_atto = u256(0)
        self.total_rewards_claimed_atto = u256(0)
        self.total_competitions = u256(0)
        self.total_submissions = u256(0)
        self.total_evaluations = u256(0)
        self.total_disputes = u256(0)

        self._log("contract_deployed", {"owner": self._addr_str(self.owner)})

    # ==================================================================
    # Internal helpers — deterministic only
    # ==================================================================
    @staticmethod
    def _addr_str(addr: Address) -> str:
        return addr.as_hex

    def _sender(self) -> str:
        return self._addr_str(gl.message.sender_address)

    def _require_not_paused(self) -> None:
        if self.paused:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract is paused")

    def _require_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only owner may call this")

    def _require_admin(self) -> None:
        sender = self._sender()
        if not (sender in self.admins and self.admins[sender]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only admin may call this")

    def _require_creator_or_admin(self, comp: Competition) -> None:
        sender = self._sender()
        if comp.created_by == sender:
            return
        if sender in self.admins and self.admins[sender]:
            return
        raise gl.vm.UserError(
            f"{ERROR_EXPECTED} Only the competition creator or an admin may do this"
        )

    def _log(self, event: str, data: dict) -> None:
        # Keep audit entries compact; storage is not free.
        try:
            payload = json.dumps(
                {"e": event, "d": data}, sort_keys=True, separators=(",", ":")
            )
        except (TypeError, ValueError):
            payload = json.dumps({"e": event, "d": "unserializable"})
        if len(payload) > 800:
            payload = payload[:800]
        self.audit_log.append(payload)

    def _get_weights(self) -> dict:
        try:
            weights = json.loads(self.weights_json)
        except (ValueError, TypeError):
            weights = dict(DEFAULT_WEIGHTS_BP)
        # Guarantee every criterion has a weight even after config mistakes.
        for criterion in CRITERIA:
            if criterion not in weights:
                weights[criterion] = DEFAULT_WEIGHTS_BP[criterion]
        return weights

    def _get_competition(self, competition_id: str) -> Competition:
        if competition_id not in self.competitions:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Competition not found: {competition_id}"
            )
        return self.competitions[competition_id]

    def _get_submission(self, submission_id: str) -> Submission:
        if submission_id not in self.submissions:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Submission not found: {submission_id}"
            )
        return self.submissions[submission_id]

    def _comp_submission_ids(self, competition_id: str) -> list:
        if competition_id not in self.competition_submissions_json:
            return []
        raw = self.competition_submissions_json[competition_id]
        try:
            ids = json.loads(raw)
            return ids if isinstance(ids, list) else []
        except (ValueError, TypeError):
            return []

    def _append_comp_submission(self, competition_id: str, submission_id: str) -> None:
        ids = self._comp_submission_ids(competition_id)
        ids.append(submission_id)
        self.competition_submissions_json[competition_id] = json.dumps(
            ids, separators=(",", ":")
        )

    @staticmethod
    def _normalize_url(url: str) -> str:
        u = url.strip().lower()
        u = re.sub(r"^https?://", "", u)
        u = re.sub(r"^www\.", "", u)
        u = u.split("?")[0].split("#")[0].rstrip("/")
        return u

    @staticmethod
    def _validate_url(url: str, field: str) -> None:
        if not url or len(url) > MAX_URL_LEN:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} {field} must be 1..{MAX_URL_LEN} chars"
            )
        if not re.match(r"^https?://[^\s]+\.[^\s]+", url):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} {field} must be a valid http(s) URL"
            )

    def _touch_user(self, address: str) -> UserStats:
        if address not in self.user_stats:
            self.user_stats[address] = UserStats(
                address=address,
                submissions=u256(0),
                wins=u256(0),
                total_score_accum=u256(0),
                rewards_atto=u256(0),
                disqualifications=u256(0),
                last_submission_at="",
            )
        return self.user_stats[address]

    # ------------------------------------------------------------------
    # Nondeterministic helpers — only callable inside nondet closures.
    # ------------------------------------------------------------------
    @staticmethod
    def _web_get(url: str):
        """Fetch a URL inside a nondet block, classifying failures."""
        try:
            response = gl.nondet.web.get(url)
        except Exception as exc:  # network layer failure — transient
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} web fetch failed: {exc}")
        status = getattr(response, "status", 0)
        if 400 <= status < 500:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} HTTP {status} for resource")
        if status >= 500:
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} HTTP {status} upstream error")
        return response

    @staticmethod
    def _web_text(url: str) -> str:
        """Render a page as text inside a nondet block, tolerant to SDK API
        surface differences between runner versions."""
        render = getattr(getattr(gl.nondet, "web", None), "render", None)
        if render is not None:
            try:
                return str(render(url, mode="text"))
            except TypeError:
                pass
        get_webpage = getattr(gl, "get_webpage", None)
        if get_webpage is not None:
            return str(get_webpage(url, mode="text"))
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} no web render capability")

    @staticmethod
    def _exec_prompt_json(prompt: str) -> dict:
        """Run an LLM prompt and coerce the response into a dict."""
        try:
            result = gl.nondet.exec_prompt(prompt, response_format="json")
        except Exception as exc:
            raise gl.vm.UserError(f"{ERROR_LLM} exec_prompt failed: {exc}")
        if isinstance(result, dict):
            return result
        if isinstance(result, str):
            parsed = MemeOlympics._parse_json_text(result)
            if parsed is not None:
                return parsed
        raise gl.vm.UserError(
            f"{ERROR_LLM} LLM returned non-JSON response: {type(result)}"
        )

    @staticmethod
    def _parse_json_text(text: str):
        """Clean typical LLM JSON wrapping: prose, code fences, trailing commas."""
        try:
            first = text.find("{")
            last = text.rfind("}")
            if first == -1 or last == -1 or last <= first:
                return None
            snippet = text[first : last + 1]
            snippet = re.sub(r",(\s*[}\]])", r"\1", snippet)
            parsed = json.loads(snippet)
            return parsed if isinstance(parsed, dict) else None
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _coerce_int(value, lo: int, hi: int, field: str) -> int:
        """Aggressively coerce an LLM-provided number into a clamped int."""
        if value is None:
            raise gl.vm.UserError(f"{ERROR_LLM} missing numeric field '{field}'")
        try:
            number = int(round(float(str(value).strip())))
        except (ValueError, TypeError):
            raise gl.vm.UserError(
                f"{ERROR_LLM} non-numeric field '{field}': {value}"
            )
        return max(lo, min(hi, number))

    @staticmethod
    def _pick(analysis: dict, key: str, aliases: tuple):
        """Fetch a key from an LLM dict with common alias fallbacks."""
        if key in analysis:
            return analysis[key]
        for alias in aliases:
            if alias in analysis:
                return analysis[alias]
        return None

    @staticmethod
    def _handle_leader_error(leaders_res, leader_fn) -> bool:
        """Canonical validator-side comparison when the leader errored.

        Deterministic errors must match exactly; transient errors agree if
        both sides are transient; LLM/unknown errors force disagreement so
        consensus rotates the leader instead of persisting garbage.
        """
        leader_msg = getattr(leaders_res, "message", "") or ""
        try:
            leader_fn()
            return False  # leader failed, validator succeeded -> disagree
        except gl.vm.UserError as exc:
            validator_msg = getattr(exc, "message", None) or str(exc)
            if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(
                ERROR_EXTERNAL
            ):
                return validator_msg == leader_msg
            if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(
                ERROR_TRANSIENT
            ):
                return True
            return False
        except Exception:
            return False

    # ==================================================================
    # Admin & configuration (deterministic writes)
    # ==================================================================
    @gl.public.write
    def claim_initial_owner(self) -> None:
        """One-time bootstrap for a known deployment quirk: some deploy
        paths present a zero sender to the constructor (and/or drop
        constructor args), leaving self.owner as the zero address. If that
        happened, the first caller of this regular (non-constructor) method
        becomes owner/admin — sender_address is reliable on ordinary calls.
        A no-op safety door: rejected once a real owner already exists."""
        zero = Address("0x0000000000000000000000000000000000000000")
        if self.owner != zero:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Owner already set")
        self.owner = gl.message.sender_address
        self.admins[self._addr_str(self.owner)] = True
        self._log("owner_claimed", {"owner": self._addr_str(self.owner)})

    @gl.public.write
    def transfer_ownership(self, new_owner: str) -> None:
        self._require_owner()
        new_addr = Address(new_owner)
        self.owner = new_addr
        self.admins[self._addr_str(new_addr)] = True
        self._log("ownership_transferred", {"to": new_owner})

    @gl.public.write
    def add_admin(self, admin_address: str) -> None:
        self._require_owner()
        self.admins[Address(admin_address).as_hex] = True
        self._log("admin_added", {"admin": admin_address})

    @gl.public.write
    def remove_admin(self, admin_address: str) -> None:
        self._require_owner()
        key = Address(admin_address).as_hex
        if key == self._addr_str(self.owner):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Cannot remove owner from admins")
        if key in self.admins:
            self.admins[key] = False
        self._log("admin_removed", {"admin": admin_address})

    @gl.public.write
    def set_paused(self, paused: bool) -> None:
        self._require_admin()
        self.paused = paused
        self._log("paused_set", {"paused": paused})

    @gl.public.write
    def set_weights(self, weights_json: str) -> None:
        """Update criterion weights (basis points). Must cover all criteria
        and sum to 10000."""
        self._require_admin()
        try:
            weights = json.loads(weights_json)
        except (ValueError, TypeError):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} weights_json is not valid JSON")
        if not isinstance(weights, dict):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} weights_json must be an object")
        total = 0
        for criterion in CRITERIA:
            if criterion not in weights:
                raise gl.vm.UserError(
                    f"{ERROR_EXPECTED} missing weight for '{criterion}'"
                )
            try:
                w = int(weights[criterion])
            except (ValueError, TypeError):
                raise gl.vm.UserError(
                    f"{ERROR_EXPECTED} weight for '{criterion}' must be an integer"
                )
            if w < 0 or w > 10000:
                raise gl.vm.UserError(
                    f"{ERROR_EXPECTED} weight for '{criterion}' out of range"
                )
            total += w
        if total != 10000:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} weights must sum to 10000, got {total}"
            )
        self.weights_json = json.dumps(
            {c: int(weights[c]) for c in CRITERIA}, sort_keys=True
        )
        self._log("weights_updated", {})

    @gl.public.write
    def set_competition_defaults(self, winner_count: int, max_per_user: int) -> None:
        """Default winner count / per-user submission cap for NEW
        competitions. Prize pools are no longer a config default — they are
        real GEN, funded per-competition via create_competition's payable
        value or fund_competition."""
        self._require_admin()
        if winner_count < 1 or winner_count > 25:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} winner_count must be 1..25")
        if max_per_user < 1 or max_per_user > 20:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} max_per_user must be 1..20")
        self.default_winner_count = u256(winner_count)
        self.max_submissions_per_user = u256(max_per_user)
        self._log(
            "defaults_updated", {"winners": winner_count, "mpu": max_per_user}
        )

    # ==================================================================
    # Competition lifecycle (deterministic writes)
    # ==================================================================
    @gl.public.write.payable
    def create_competition(
        self,
        competition_id: str,
        title: str,
        theme: str,
        starts_at: str,
        ends_at: str,
    ) -> None:
        """Create a competition. OPEN TO ALL — anyone can host an arena.
        IDs are caller-supplied (e.g. 'week-2026-28') so the off-chain
        scheduler and the chain agree on naming without extra reads.
        Anti-spam: non-admins are capped at 5 creations per account.

        PAYABLE: any GEN sent with this call becomes the competition's real,
        escrowed prize pool (0 is valid — a prestige-only arena with no
        monetary reward). Anyone can add more later via fund_competition."""
        self._require_not_paused()
        funded = u256(int(gl.message.value))
        sender = self._sender()
        if not (sender in self.admins and self.admins[sender]):
            creator_key = f"created_by:{sender}"
            created_count = int(self.user_comp_submission_count[creator_key]) if (
                creator_key in self.user_comp_submission_count
            ) else 0
            if created_count >= 5:
                raise gl.vm.UserError(
                    f"{ERROR_EXPECTED} Competition creation limit reached (5 per account)"
                )
            self.user_comp_submission_count[creator_key] = u256(created_count + 1)

        if not re.match(r"^[a-z0-9][a-z0-9\-]{2,63}$", competition_id):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} competition_id must be 3..64 chars of [a-z0-9-]"
            )
        if competition_id in self.competitions:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Competition already exists: {competition_id}"
            )
        if not title or len(title) > MAX_TITLE_LEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} title must be 1..{MAX_TITLE_LEN}")
        if len(theme) > MAX_CAPTION_LEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} theme too long")

        self.competitions[competition_id] = Competition(
            id=competition_id,
            title=title,
            theme=theme,
            status=COMP_STATUS_CREATED,
            starts_at=starts_at,
            ends_at=ends_at,
            prize_pool_atto=funded,
            winner_count=self.default_winner_count,
            submission_count=u256(0),
            created_by=self._sender(),
            created_at=starts_at,
            finalized_at="",
            winners_json="[]",
        )
        self.competition_ids.append(competition_id)
        self.total_competitions = u256(int(self.total_competitions) + 1)
        self._log(
            "competition_created",
            {"id": competition_id, "funded_atto": int(funded)},
        )

    @gl.public.write.payable
    def fund_competition(self, competition_id: str) -> None:
        """Add GEN to a competition's real prize pool. Open to anyone —
        the host, sponsors, or the community — as long as the arena hasn't
        finalized or been cancelled yet."""
        self._require_not_paused()
        comp = self._get_competition(competition_id)
        if comp.status in (COMP_STATUS_FINALIZED, COMP_STATUS_CANCELLED):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Competition '{comp.status}' can no longer be funded"
            )
        added = int(gl.message.value)
        if added <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Must send GEN value to fund")
        comp.prize_pool_atto = u256(int(comp.prize_pool_atto) + added)
        self._log(
            "competition_funded", {"id": competition_id, "added_atto": added}
        )

    @gl.public.write
    def open_competition(self, competition_id: str) -> None:
        """Open a competition for submissions and make it the active one.
        Allowed for the competition's creator or any admin."""
        self._require_not_paused()
        comp = self._get_competition(competition_id)
        self._require_creator_or_admin(comp)
        if comp.status != COMP_STATUS_CREATED:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Competition is '{comp.status}', expected 'created'"
            )
        # Concurrent arenas are allowed: opening one never closes another.
        # The active pointer is only a "featured" hint for UIs.
        comp.status = COMP_STATUS_OPEN
        self.active_competition_id = competition_id
        self._log("competition_opened", {"id": competition_id})

    @gl.public.write
    def close_submissions(self, competition_id: str) -> None:
        """Move an open competition into the judging phase.
        Allowed for the competition's creator or any admin."""
        comp = self._get_competition(competition_id)
        self._require_creator_or_admin(comp)
        if comp.status != COMP_STATUS_OPEN:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Competition is '{comp.status}', expected 'open'"
            )
        comp.status = COMP_STATUS_JUDGING
        if self.active_competition_id == competition_id:
            self.active_competition_id = ""
        self._log("competition_judging", {"id": competition_id})

    @gl.public.write
    def cancel_competition(self, competition_id: str, reason: str) -> None:
        self._require_admin()
        comp = self._get_competition(competition_id)
        if comp.status == COMP_STATUS_FINALIZED:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Finalized competitions cannot be cancelled"
            )
        comp.status = COMP_STATUS_CANCELLED
        if self.active_competition_id == competition_id:
            self.active_competition_id = ""
        self._log("competition_cancelled", {"id": competition_id, "r": reason[:200]})

    # ==================================================================
    # Submissions (deterministic write)
    # ==================================================================
    @gl.public.write
    def submit_meme(
        self,
        competition_id: str,
        submission_id: str,
        title: str,
        caption: str,
        image_url: str,
        context_url: str,
        tags_json: str,
        submitted_at: str,
    ) -> None:
        """Register a meme submission for the given open competition.

        The heavy AI judging happens later in `evaluate_submission`;
        registration itself is deterministic and cheap so submitting never
        risks consensus failure."""
        self._require_not_paused()
        comp = self._get_competition(competition_id)
        if comp.status != COMP_STATUS_OPEN:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Competition '{competition_id}' is not open"
            )
        if int(comp.submission_count) >= MAX_SUBMISSIONS_PER_COMPETITION:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Competition submission cap reached"
            )
        if not re.match(r"^[a-zA-Z0-9][a-zA-Z0-9\-_]{2,63}$", submission_id):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} submission_id must be 3..64 url-safe chars"
            )
        if submission_id in self.submissions:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Submission already exists: {submission_id}"
            )
        if not title or len(title) > MAX_TITLE_LEN:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} title must be 1..{MAX_TITLE_LEN} chars"
            )
        if len(caption) > MAX_CAPTION_LEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} caption too long")
        self._validate_url(image_url, "image_url")
        if context_url:
            self._validate_url(context_url, "context_url")

        # Tag validation.
        try:
            tags = json.loads(tags_json) if tags_json else []
        except (ValueError, TypeError):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} tags_json is not valid JSON")
        if not isinstance(tags, list) or len(tags) > MAX_TAGS:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} tags must be a list of <= {MAX_TAGS}")
        clean_tags = []
        for tag in tags:
            tag_str = str(tag).strip()[:MAX_TAG_LEN]
            if tag_str:
                clean_tags.append(tag_str)

        sender = self._sender()

        # Per-user submission cap for this competition.
        quota_key = f"{competition_id}:{sender}"
        used = int(self.user_comp_submission_count[quota_key]) if (
            quota_key in self.user_comp_submission_count
        ) else 0
        if used >= int(self.max_submissions_per_user):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Submission limit reached for this competition"
            )

        # Exact-duplicate image URL detection (first line of anti-recycling;
        # the AI evaluation performs the deeper originality analysis).
        norm = self._normalize_url(image_url)
        if norm in self.image_url_seen:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} This image URL was already submitted "
                f"(submission {self.image_url_seen[norm]})"
            )

        self.submissions[submission_id] = Submission(
            id=submission_id,
            competition_id=competition_id,
            author=sender,
            title=title,
            caption=caption,
            image_url=image_url,
            context_url=context_url,
            tags_json=json.dumps(clean_tags, separators=(",", ":")),
            status=SUB_STATUS_PENDING,
            submitted_at=submitted_at,
            total_score=u256(0),
            criteria_json="{}",
            plagiarism_verdict="",
            plagiarism_confidence=u256(0),
            image_accessible=False,
            evaluation_summary="",
            evaluated_at="",
        )
        self.submission_ids.append(submission_id)
        self._append_comp_submission(competition_id, submission_id)
        self.image_url_seen[norm] = submission_id
        self.user_comp_submission_count[quota_key] = u256(used + 1)

        comp.submission_count = u256(int(comp.submission_count) + 1)
        self.total_submissions = u256(int(self.total_submissions) + 1)

        stats = self._touch_user(sender)
        stats.submissions = u256(int(stats.submissions) + 1)
        stats.last_submission_at = submitted_at

        self._log("meme_submitted", {"id": submission_id, "c": competition_id})

    # ==================================================================
    # AI EVALUATION — the consensus core.
    # ==================================================================
    def _build_evaluation_prompt(
        self, sub: Submission, theme: str, page_note: str
    ) -> str:
        weights = self._get_weights()
        criteria_lines = "\n".join(
            f'- "{c}" (weight {weights[c]} bp): score 0-10' for c in CRITERIA
        )
        return f"""You are an expert judge for "Meme Olympics", a weekly crypto meme
competition. Judge the following meme submission on reasoning-based criteria,
not popularity. Be consistent, fair and moderately generous: reserve scores
below 3 for clearly poor or off-topic entries, and scores above 8 for
genuinely exceptional ones.

COMPETITION THEME: {theme or "open theme — current crypto culture"}

SUBMISSION METADATA:
- Title: {sub.title}
- Caption: {sub.caption}
- Tags: {sub.tags_json}
- Image URL: {sub.image_url}
- Context URL provided: {"yes" if sub.context_url else "no"}
- Image accessibility check: {page_note}

TASKS:
1. Score each criterion as an integer 0-10:
{criteria_lines}

2. Plagiarism / recycling assessment. Based on the title, caption, image URL,
its filename/host, and your knowledge of widely circulated memes on Reddit,
X/Twitter, Telegram, Discord, 4chan and meme archives, classify the meme:
- "original": appears to be a novel creation or a substantially transformative remix
- "suspicious": resembles a known meme format with limited transformation (this is
  NORMAL for memes — using a known template with fresh text/context is fine and
  should usually remain scoreable)
- "copied": very likely a direct repost/screenshot of existing content with no
  meaningful transformation
Give a confidence 0-100 for your classification. Only choose "copied" when the
evidence is strong; when in doubt between suspicious and copied, choose
"suspicious".

3. Write a 1-3 sentence judging summary.

Return ONLY a JSON object exactly like:
{{
  "criteria": {{ {", ".join(f'"{c}": 0' for c in CRITERIA)} }},
  "plagiarism_verdict": "original|suspicious|copied",
  "plagiarism_confidence": 0,
  "summary": "..."
}}"""

    def _run_evaluation(self, sub: Submission, theme: str) -> dict:
        """Leader/validator shared task: probe the image URL, then run the
        LLM judging prompt and normalize the result to stable fields."""
        # 1) Contract-side web access: verify the meme image actually exists.
        image_accessible = False
        page_note = "unknown"
        try:
            response = self._web_get(sub.image_url)
            image_accessible = True
            content_type = ""
            headers = getattr(response, "headers", None)
            if isinstance(headers, dict):
                for k, v in headers.items():
                    if str(k).lower() == "content-type":
                        content_type = str(v)
                        break
            page_note = f"reachable (content-type: {content_type or 'n/a'})"
        except gl.vm.UserError as exc:
            msg = getattr(exc, "message", None) or str(exc)
            if msg.startswith(ERROR_TRANSIENT):
                raise  # let transient failures classify as transient
            page_note = "NOT reachable (HTTP client error)"

        # 2) LLM judging.
        analysis = self._exec_prompt_json(
            self._build_evaluation_prompt(sub, theme, page_note)
        )

        # 3) Defensive normalization to stable decision fields.
        raw_criteria = self._pick(analysis, "criteria", ("scores", "ratings"))
        if not isinstance(raw_criteria, dict):
            raise gl.vm.UserError(f"{ERROR_LLM} missing criteria object")
        criteria_scores = {}
        for criterion in CRITERIA:
            value = raw_criteria.get(criterion)
            if value is None:
                # tolerate alias variants like "cryptoNativeUnderstanding"
                for k, v in raw_criteria.items():
                    if re.sub(r"[^a-z]", "", str(k).lower()) == re.sub(
                        r"[^a-z]", "", criterion
                    ):
                        value = v
                        break
            criteria_scores[criterion] = self._coerce_int(
                value if value is not None else 5, 0, 10, criterion
            )

        verdict = str(
            self._pick(analysis, "plagiarism_verdict", ("verdict", "plagiarism"))
            or PLAGIARISM_SUSPICIOUS
        ).strip().lower()
        if verdict not in (
            PLAGIARISM_ORIGINAL,
            PLAGIARISM_SUSPICIOUS,
            PLAGIARISM_COPIED,
        ):
            verdict = PLAGIARISM_SUSPICIOUS

        confidence = self._coerce_int(
            self._pick(analysis, "plagiarism_confidence", ("confidence",)) or 50,
            0,
            100,
            "plagiarism_confidence",
        )

        weights = self._get_weights()
        total_bp = sum(criteria_scores[c] * weights[c] for c in CRITERIA)
        total_score = max(0, min(100, total_bp // 1000))  # 10*10000bp -> 100

        summary = str(
            self._pick(analysis, "summary", ("analysis", "reasoning")) or ""
        )[:500]

        return {
            "criteria": criteria_scores,
            "total_score": int(total_score),
            "plagiarism_verdict": verdict,
            "plagiarism_confidence": int(confidence),
            "image_accessible": bool(image_accessible),
            "summary": summary,
        }

    @gl.public.write
    def evaluate_submission(self, submission_id: str) -> None:
        """Run the AI judging pipeline for one submission under consensus.

        The leader performs image probing + LLM scoring; every validator
        INDEPENDENTLY re-runs the same task and compares the substantive
        decision fields with explicit tolerances. Validators never accept a
        leader result on format alone."""
        self._require_not_paused()
        sub = self._get_submission(submission_id)
        comp = self._get_competition(sub.competition_id)
        if comp.status not in (COMP_STATUS_OPEN, COMP_STATUS_JUDGING):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Competition is '{comp.status}'; cannot evaluate"
            )
        if sub.status not in (SUB_STATUS_PENDING,):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Submission is '{sub.status}'; already processed"
            )

        theme = comp.theme
        # Snapshot plain values for the nondet closures (avoid touching
        # storage objects inside nondet blocks).
        sub_snapshot = Submission(
            id=sub.id,
            competition_id=sub.competition_id,
            author=sub.author,
            title=sub.title,
            caption=sub.caption,
            image_url=sub.image_url,
            context_url=sub.context_url,
            tags_json=sub.tags_json,
            status=sub.status,
            submitted_at=sub.submitted_at,
            total_score=u256(0),
            criteria_json="{}",
            plagiarism_verdict="",
            plagiarism_confidence=u256(0),
            image_accessible=False,
            evaluation_summary="",
            evaluated_at="",
        )

        contract = self

        def leader_fn() -> dict:
            return contract._run_evaluation(sub_snapshot, theme)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return MemeOlympics._handle_leader_error(leaders_res, leader_fn)

            leader = leaders_res.calldata
            if not isinstance(leader, dict):
                return False

            # Independent re-derivation — the validator does the task itself.
            try:
                mine = leader_fn()
            except gl.vm.UserError as exc:
                msg = getattr(exc, "message", None) or str(exc)
                # Leader succeeded but validator hit transient trouble:
                # accept the leader rather than rotating for network noise.
                return msg.startswith(ERROR_TRANSIENT)
            except Exception:
                return False

            # --- Gate 1: plagiarism "copied" is a hard gate. Both sides
            # must agree on whether the meme is disqualified. "original" vs
            # "suspicious" disagreement is tolerated (does not disqualify).
            leader_verdict = str(leader.get("plagiarism_verdict", ""))
            leader_conf = leader.get("plagiarism_confidence", 0)
            try:
                leader_conf = int(leader_conf)
            except (ValueError, TypeError):
                return False
            leader_dq = (
                leader_verdict == PLAGIARISM_COPIED and leader_conf >= 70
            )
            my_dq = (
                mine["plagiarism_verdict"] == PLAGIARISM_COPIED
                and mine["plagiarism_confidence"] >= 70
            )
            if leader_dq != my_dq:
                # Soft escape hatch: near-threshold confidence differences
                # should not rotate the leader forever. If verdicts are both
                # copied-ish (copied/suspicious) treat as agreement.
                both_copied_ish = leader_verdict in (
                    PLAGIARISM_COPIED,
                    PLAGIARISM_SUSPICIOUS,
                ) and mine["plagiarism_verdict"] in (
                    PLAGIARISM_COPIED,
                    PLAGIARISM_SUSPICIOUS,
                )
                if not both_copied_ish:
                    return False

            # --- Gate 2: total score tolerance.
            try:
                leader_total = int(leader.get("total_score", -1))
            except (ValueError, TypeError):
                return False
            if leader_total < 0 or leader_total > 100:
                return False
            if abs(leader_total - mine["total_score"]) > SCORE_TOLERANCE:
                return False

            # --- Gate 3: per-criterion sanity (loose). Every leader score
            # must be a valid 0..10 int and within tolerance of the
            # validator's own score for at least 7 of 9 criteria.
            leader_criteria = leader.get("criteria")
            if not isinstance(leader_criteria, dict):
                return False
            close_enough = 0
            for criterion in CRITERIA:
                try:
                    lv = int(leader_criteria.get(criterion, -1))
                except (ValueError, TypeError):
                    return False
                if lv < 0 or lv > 10:
                    return False
                if abs(lv - mine["criteria"][criterion]) <= CRITERION_TOLERANCE:
                    close_enough += 1
            if close_enough < 7:
                return False

            # --- Gate 4: image accessibility must match (it is a near-
            # deterministic fact; disagreement means someone's fetch lied).
            if bool(leader.get("image_accessible")) != mine["image_accessible"]:
                # tolerate flaky hosting: only fail when validator says the
                # image exists but leader claimed it does not
                if mine["image_accessible"] and not leader.get("image_accessible"):
                    return False

            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        # ------------------------------------------------------------------
        # Deterministic state update from the agreed result.
        # ------------------------------------------------------------------
        sub.criteria_json = json.dumps(result["criteria"], sort_keys=True)
        sub.total_score = u256(int(result["total_score"]))
        sub.plagiarism_verdict = str(result["plagiarism_verdict"])
        sub.plagiarism_confidence = u256(int(result["plagiarism_confidence"]))
        sub.image_accessible = bool(result["image_accessible"])
        sub.evaluation_summary = str(result["summary"])[:500]
        sub.evaluated_at = sub.submitted_at  # chain has no clock; see docs

        disqualified = (
            result["plagiarism_verdict"] == PLAGIARISM_COPIED
            and int(result["plagiarism_confidence"]) >= 70
        ) or not result["image_accessible"]

        if disqualified:
            sub.status = SUB_STATUS_DISQUALIFIED
            stats = self._touch_user(sub.author)
            stats.disqualifications = u256(int(stats.disqualifications) + 1)
        else:
            sub.status = SUB_STATUS_EVALUATED
            stats = self._touch_user(sub.author)
            stats.total_score_accum = u256(
                int(stats.total_score_accum) + int(result["total_score"])
            )

        self.total_evaluations = u256(int(self.total_evaluations) + 1)
        self._log(
            "submission_evaluated",
            {
                "id": submission_id,
                "s": int(result["total_score"]),
                "v": result["plagiarism_verdict"],
                "dq": disqualified,
            },
        )

    # ==================================================================
    # Finalization & rewards (fully deterministic)
    # ==================================================================
    @gl.public.write
    def finalize_competition(self, competition_id: str, finalized_at: str) -> None:
        """Deterministically rank evaluated submissions, select winners and
        allocate real GEN rewards (claimable via claim_reward). No LLM/web
        calls — cannot fail consensus. Allowed for the competition's creator
        or any admin, so hosts can end their own arena without waiting on
        an admin."""
        comp = self._get_competition(competition_id)
        self._require_creator_or_admin(comp)
        if comp.status != COMP_STATUS_JUDGING:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Competition is '{comp.status}', expected 'judging'"
            )

        sub_ids = self._comp_submission_ids(competition_id)
        ranked = []
        for sid in sub_ids:
            if sid not in self.submissions:
                continue
            sub = self.submissions[sid]
            if sub.status != SUB_STATUS_EVALUATED:
                continue
            # Deterministic tiebreak: score desc, then id asc (stable, no clock)
            ranked.append((-int(sub.total_score), sid))
        ranked.sort()

        winner_count = min(int(comp.winner_count), len(ranked))
        pool = int(comp.prize_pool_atto)

        # Reward split: rank-weighted harmonic-style distribution that always
        # sums to <= pool using integer math. Weights: 1st=50%, 2nd=30%,
        # 3rd=20% for 3 winners; generalized as descending shares.
        shares = self._reward_shares(winner_count)
        winners = []
        for index in range(winner_count):
            sid = ranked[index][1]
            sub = self.submissions[sid]
            reward = pool * shares[index] // 10000
            sub.status = SUB_STATUS_WINNER

            stats = self._touch_user(sub.author)
            stats.wins = u256(int(stats.wins) + 1)
            stats.rewards_atto = u256(int(stats.rewards_atto) + reward)

            balance = int(self.reward_balances_atto[sub.author]) if (
                sub.author in self.reward_balances_atto
            ) else 0
            self.reward_balances_atto[sub.author] = u256(balance + reward)
            self.total_rewards_distributed_atto = u256(
                int(self.total_rewards_distributed_atto) + reward
            )
            winners.append(
                {
                    "submission_id": sid,
                    "author": sub.author,
                    "rank": index + 1,
                    "score": int(sub.total_score),
                    "reward_atto": str(reward),
                }
            )

        comp.winners_json = json.dumps(winners, separators=(",", ":"))
        comp.status = COMP_STATUS_FINALIZED
        comp.finalized_at = finalized_at
        if self.active_competition_id == competition_id:
            self.active_competition_id = ""

        self._log(
            "competition_finalized",
            {"id": competition_id, "winners": len(winners)},
        )

    @staticmethod
    def _reward_shares(winner_count: int) -> list:
        """Descending integer shares in basis points summing to 10000."""
        if winner_count <= 0:
            return []
        if winner_count == 1:
            return [10000]
        if winner_count == 2:
            return [6000, 4000]
        if winner_count == 3:
            return [5000, 3000, 2000]
        # Generalized: weight n-i for rank i, normalized to 10000 bp.
        weights = [winner_count - i for i in range(winner_count)]
        total = sum(weights)
        shares = [w * 10000 // total for w in weights]
        shares[0] += 10000 - sum(shares)  # dust to rank 1
        return shares

    # ==================================================================
    # Reward claims — REAL GEN value transfer, not an internal points ledger.
    # ==================================================================
    @gl.public.write
    def claim_reward(self) -> None:
        """Pull your full accumulated GEN reward balance out of the
        contract's own escrowed funds, in one on-chain native transfer to
        your own wallet. Self-serve: only the caller can claim their own
        balance, and only what this contract actually holds.

        Note: rewards accumulate across ALL competitions you've won. If a
        plagiarism dispute is later upheld against a submission whose reward
        you already claimed, the GEN cannot be recovered — on-chain value
        transfers are irreversible, same as any other blockchain payout."""
        self._require_not_paused()
        sender = self._sender()
        amount = (
            int(self.reward_balances_atto[sender])
            if sender in self.reward_balances_atto
            else 0
        )
        if amount <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No claimable GEN reward")
        if amount > int(self.balance):
            # Should never happen if funding/accounting stayed consistent;
            # fail safe rather than attempt a transfer the contract can't cover.
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Contract balance insufficient for claim"
            )
        # Checks-effects-interactions: zero the claimable balance BEFORE
        # sending value out, so a re-entrant or repeated claim call sees 0.
        self.reward_balances_atto[sender] = u256(0)
        gl.get_contract_at(Address(sender)).emit(value=u256(amount)).emit_transfer()
        self.total_rewards_claimed_atto = u256(
            int(self.total_rewards_claimed_atto) + amount
        )
        self._log("reward_claimed", {"addr": sender, "amount_atto": amount})

    # ==================================================================
    # Disputes — evidence-based, contract-side web verification
    # ==================================================================
    @gl.public.write
    def open_dispute(
        self,
        dispute_id: str,
        submission_id: str,
        reason: str,
        evidence_url: str,
        opened_at: str,
    ) -> None:
        """Open a plagiarism/misjudgment dispute against a submission.

        The disputer must supply a public evidence URL (e.g. a Reddit or X
        post showing the meme existed earlier). Resolution fetches that
        evidence ON-CHAIN — user-submitted text alone never decides."""
        self._require_not_paused()
        sub = self._get_submission(submission_id)
        if sub.status not in (SUB_STATUS_EVALUATED, SUB_STATUS_WINNER):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Only evaluated or winning submissions can be disputed"
            )
        if not re.match(r"^[a-zA-Z0-9][a-zA-Z0-9\-_]{2,63}$", dispute_id):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} invalid dispute_id")
        if dispute_id in self.disputes:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Dispute already exists")
        if not reason or len(reason) > MAX_DISPUTE_REASON_LEN:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} reason must be 1..{MAX_DISPUTE_REASON_LEN} chars"
            )
        self._validate_url(evidence_url, "evidence_url")

        count_key = submission_id
        existing = int(self.submission_dispute_count[count_key]) if (
            count_key in self.submission_dispute_count
        ) else 0
        if existing >= 3:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Dispute limit reached for this submission"
            )

        self.disputes[dispute_id] = Dispute(
            id=dispute_id,
            submission_id=submission_id,
            competition_id=sub.competition_id,
            opened_by=self._sender(),
            reason=reason,
            evidence_url=evidence_url,
            status=DISPUTE_STATUS_OPEN,
            verdict_summary="",
            opened_at=opened_at,
            resolved_at="",
        )
        self.dispute_ids.append(dispute_id)
        self.submission_dispute_count[count_key] = u256(existing + 1)
        self.total_disputes = u256(int(self.total_disputes) + 1)
        self._log("dispute_opened", {"id": dispute_id, "sub": submission_id})

    def _run_dispute_analysis(
        self, dispute: Dispute, sub: Submission
    ) -> dict:
        """Shared leader/validator task for dispute resolution: fetch the
        evidence page on-chain, then reason over it."""
        evidence_excerpt = ""
        evidence_fetched = False
        try:
            text = self._web_text(dispute.evidence_url)
            evidence_excerpt = text[:4000]
            evidence_fetched = True
        except gl.vm.UserError as exc:
            msg = getattr(exc, "message", None) or str(exc)
            if msg.startswith(ERROR_TRANSIENT):
                raise
            evidence_excerpt = "(evidence URL could not be fetched: client error)"

        prompt = f"""You are resolving a dispute in a crypto meme competition.

DISPUTED SUBMISSION:
- Title: {sub.title}
- Caption: {sub.caption}
- Image URL: {sub.image_url}
- Current plagiarism verdict: {sub.plagiarism_verdict} \
(confidence {int(sub.plagiarism_confidence)})
- Score: {int(sub.total_score)}/100

DISPUTE:
- Claim by disputer: {dispute.reason}
- Evidence URL: {dispute.evidence_url}
- Evidence page fetched on-chain: {"yes" if evidence_fetched else "NO — could not fetch"}

EVIDENCE PAGE CONTENT (first 4000 chars):
{evidence_excerpt}

TASK: Decide whether the dispute should be UPHELD (the evidence genuinely
demonstrates the claim, e.g. the meme was published elsewhere earlier or the
judgment was clearly wrong) or REJECTED. IMPORTANT RULES:
- If the evidence page could not be fetched, you MUST reject: claims cannot
  be resolved from the disputer's text alone.
- Only uphold when the evidence content concretely supports the claim.
- When genuinely uncertain, reject (submissions keep the benefit of doubt).

Return ONLY JSON: {{"uphold": true/false, "confidence": 0-100, "summary": "1-2 sentences"}}"""

        analysis = self._exec_prompt_json(prompt)
        uphold_raw = self._pick(analysis, "uphold", ("upheld", "decision", "verdict"))
        if isinstance(uphold_raw, str):
            uphold = uphold_raw.strip().lower() in ("true", "uphold", "upheld", "yes")
        else:
            uphold = bool(uphold_raw)
        if not evidence_fetched:
            uphold = False  # hard rule mirrored in code, not just the prompt
        confidence = self._coerce_int(
            self._pick(analysis, "confidence", ("certainty",)) or 50, 0, 100, "confidence"
        )
        summary = str(self._pick(analysis, "summary", ("reasoning",)) or "")[:400]
        return {
            "uphold": uphold,
            "confidence": confidence,
            "summary": summary,
            "evidence_fetched": evidence_fetched,
        }

    @gl.public.write
    def resolve_dispute(self, dispute_id: str, resolved_at: str) -> None:
        """Resolve a dispute under consensus. Validators independently fetch
        the same evidence and re-derive the verdict; agreement is on the
        uphold/reject decision, not prose."""
        self._require_not_paused()
        if dispute_id not in self.disputes:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Dispute not found: {dispute_id}")
        dispute = self.disputes[dispute_id]
        if dispute.status != DISPUTE_STATUS_OPEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Dispute already resolved")
        sub = self._get_submission(dispute.submission_id)

        dispute_snapshot = Dispute(
            id=dispute.id,
            submission_id=dispute.submission_id,
            competition_id=dispute.competition_id,
            opened_by=dispute.opened_by,
            reason=dispute.reason,
            evidence_url=dispute.evidence_url,
            status=dispute.status,
            verdict_summary="",
            opened_at=dispute.opened_at,
            resolved_at="",
        )
        sub_snapshot = Submission(
            id=sub.id,
            competition_id=sub.competition_id,
            author=sub.author,
            title=sub.title,
            caption=sub.caption,
            image_url=sub.image_url,
            context_url=sub.context_url,
            tags_json=sub.tags_json,
            status=sub.status,
            submitted_at=sub.submitted_at,
            total_score=sub.total_score,
            criteria_json=sub.criteria_json,
            plagiarism_verdict=sub.plagiarism_verdict,
            plagiarism_confidence=sub.plagiarism_confidence,
            image_accessible=sub.image_accessible,
            evaluation_summary="",
            evaluated_at="",
        )

        contract = self

        def leader_fn() -> dict:
            return contract._run_dispute_analysis(dispute_snapshot, sub_snapshot)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return MemeOlympics._handle_leader_error(leaders_res, leader_fn)
            leader = leaders_res.calldata
            if not isinstance(leader, dict):
                return False
            try:
                mine = leader_fn()
            except gl.vm.UserError as exc:
                msg = getattr(exc, "message", None) or str(exc)
                return msg.startswith(ERROR_TRANSIENT)
            except Exception:
                return False

            # Decision gate: uphold/reject must match…
            if bool(leader.get("uphold")) != mine["uphold"]:
                # …unless both are low-confidence borderline calls, where we
                # defer to the leader to avoid rotation loops on 50/50 cases.
                try:
                    leader_conf = int(leader.get("confidence", 0))
                except (ValueError, TypeError):
                    return False
                if leader_conf >= 65 or mine["confidence"] >= 65:
                    return False

            # Evidence-fetched must not be contradicted in the strict
            # direction (leader claims fetched, validator could not is
            # tolerable network variance; the reverse suggests a lying leader
            # only when leader also upheld).
            if (
                mine["evidence_fetched"]
                and not bool(leader.get("evidence_fetched"))
                and bool(leader.get("uphold"))
            ):
                return False

            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        # Deterministic settlement.
        if result["uphold"]:
            dispute.status = DISPUTE_STATUS_UPHELD
            previous_status = sub.status
            sub.status = SUB_STATUS_DISQUALIFIED
            sub.plagiarism_verdict = PLAGIARISM_COPIED
            stats = self._touch_user(sub.author)
            stats.disqualifications = u256(int(stats.disqualifications) + 1)

            # Claw back rewards if the submission had already won.
            if previous_status == SUB_STATUS_WINNER:
                self._claw_back_reward(sub)
        else:
            dispute.status = DISPUTE_STATUS_REJECTED

        dispute.verdict_summary = str(result["summary"])[:400]
        dispute.resolved_at = resolved_at
        self._log(
            "dispute_resolved",
            {"id": dispute_id, "u": result["uphold"]},
        )

    def _claw_back_reward(self, sub: Submission) -> None:
        """Remove a disqualified winner's reward from balances (deterministic).

        Limitation: this only reduces the CLAIMABLE ledger. If the winner
        already called claim_reward and the real GEN already left the
        contract, that transfer cannot be reversed — the balance is bounded
        at 0 rather than going negative. This mirrors any blockchain payout:
        on-chain transfers are irreversible once sent."""
        comp = self._get_competition(sub.competition_id)
        try:
            winners = json.loads(comp.winners_json)
        except (ValueError, TypeError):
            winners = []
        remaining = []
        for w in winners:
            if w.get("submission_id") == sub.id:
                reward = int(w.get("reward_atto", "0"))
                balance = int(self.reward_balances_atto[sub.author]) if (
                    sub.author in self.reward_balances_atto
                ) else 0
                self.reward_balances_atto[sub.author] = u256(
                    max(0, balance - reward)
                )
                stats = self._touch_user(sub.author)
                stats.rewards_atto = u256(max(0, int(stats.rewards_atto) - reward))
                stats.wins = u256(max(0, int(stats.wins) - 1))
                self.total_rewards_distributed_atto = u256(
                    max(0, int(self.total_rewards_distributed_atto) - reward)
                )
            else:
                remaining.append(w)
        comp.winners_json = json.dumps(remaining, separators=(",", ":"))

    # ==================================================================
    # Views — read-only, no gas surprises
    # ==================================================================
    @gl.public.view
    def get_contract_info(self) -> dict:
        return {
            "name": "MemeOlympics",
            "version": "1.0.0",
            "owner": self._addr_str(self.owner),
            "paused": self.paused,
            "active_competition_id": self.active_competition_id,
            "total_competitions": int(self.total_competitions),
            "total_submissions": int(self.total_submissions),
            "total_evaluations": int(self.total_evaluations),
            "total_disputes": int(self.total_disputes),
            "total_rewards_distributed_atto": str(
                int(self.total_rewards_distributed_atto)
            ),
            "total_rewards_claimed_atto": str(int(self.total_rewards_claimed_atto)),
            "contract_gen_balance_atto": str(int(self.balance)),
            "criteria": list(CRITERIA),
        }

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "weights_bp": self._get_weights(),
            "default_winner_count": int(self.default_winner_count),
            "max_submissions_per_user": int(self.max_submissions_per_user),
            "max_submissions_per_competition": MAX_SUBMISSIONS_PER_COMPETITION,
            "score_tolerance": SCORE_TOLERANCE,
        }

    @gl.public.view
    def is_admin(self, address: str) -> bool:
        key = Address(address).as_hex
        return bool(key in self.admins and self.admins[key])

    @gl.public.view
    def get_competition(self, competition_id: str) -> dict:
        comp = self._get_competition(competition_id)
        return {
            "id": comp.id,
            "title": comp.title,
            "theme": comp.theme,
            "status": comp.status,
            "starts_at": comp.starts_at,
            "ends_at": comp.ends_at,
            "prize_pool_atto": str(int(comp.prize_pool_atto)),
            "winner_count": int(comp.winner_count),
            "submission_count": int(comp.submission_count),
            "created_by": comp.created_by,
            "finalized_at": comp.finalized_at,
            "winners": json.loads(comp.winners_json or "[]"),
        }

    @gl.public.view
    def get_active_competition(self) -> dict:
        if not self.active_competition_id:
            return {"active": False}
        result = self.get_competition(self.active_competition_id)
        result["active"] = True
        return result

    @gl.public.view
    def list_competitions(self, offset: int, limit: int) -> list:
        """Paginated newest-first competition summaries."""
        limit = max(1, min(50, limit))
        offset = max(0, offset)
        total = len(self.competition_ids)
        out = []
        index = total - 1 - offset
        while index >= 0 and len(out) < limit:
            cid = self.competition_ids[index]
            comp = self.competitions[cid]
            out.append(
                {
                    "id": comp.id,
                    "title": comp.title,
                    "status": comp.status,
                    "starts_at": comp.starts_at,
                    "ends_at": comp.ends_at,
                    "submission_count": int(comp.submission_count),
                }
            )
            index -= 1
        return out

    @gl.public.view
    def get_submission(self, submission_id: str) -> dict:
        sub = self._get_submission(submission_id)
        return {
            "id": sub.id,
            "competition_id": sub.competition_id,
            "author": sub.author,
            "title": sub.title,
            "caption": sub.caption,
            "image_url": sub.image_url,
            "context_url": sub.context_url,
            "tags": json.loads(sub.tags_json or "[]"),
            "status": sub.status,
            "submitted_at": sub.submitted_at,
            "total_score": int(sub.total_score),
            "criteria": json.loads(sub.criteria_json or "{}"),
            "plagiarism_verdict": sub.plagiarism_verdict,
            "plagiarism_confidence": int(sub.plagiarism_confidence),
            "image_accessible": sub.image_accessible,
            "evaluation_summary": sub.evaluation_summary,
        }

    @gl.public.view
    def list_competition_submissions(self, competition_id: str) -> list:
        self._get_competition(competition_id)
        out = []
        for sid in self._comp_submission_ids(competition_id):
            if sid not in self.submissions:
                continue
            sub = self.submissions[sid]
            out.append(
                {
                    "id": sub.id,
                    "author": sub.author,
                    "title": sub.title,
                    "image_url": sub.image_url,
                    "status": sub.status,
                    "total_score": int(sub.total_score),
                    "plagiarism_verdict": sub.plagiarism_verdict,
                }
            )
        return out

    @gl.public.view
    def get_leaderboard(self, competition_id: str) -> list:
        """Score-ranked evaluated/winner submissions for one competition."""
        self._get_competition(competition_id)
        entries = []
        for sid in self._comp_submission_ids(competition_id):
            if sid not in self.submissions:
                continue
            sub = self.submissions[sid]
            if sub.status in (SUB_STATUS_EVALUATED, SUB_STATUS_WINNER):
                entries.append((-int(sub.total_score), sid))
        entries.sort()
        out = []
        rank = 1
        for negative_score, sid in entries:
            sub = self.submissions[sid]
            out.append(
                {
                    "rank": rank,
                    "submission_id": sid,
                    "author": sub.author,
                    "title": sub.title,
                    "image_url": sub.image_url,
                    "score": -negative_score,
                    "status": sub.status,
                }
            )
            rank += 1
        return out

    @gl.public.view
    def get_user_stats(self, address: str) -> dict:
        key = Address(address).as_hex
        if key not in self.user_stats:
            return {
                "address": key,
                "submissions": 0,
                "wins": 0,
                "total_score_accum": 0,
                "rewards_atto": "0",
                "disqualifications": 0,
            }
        stats = self.user_stats[key]
        return {
            "address": stats.address,
            "submissions": int(stats.submissions),
            "wins": int(stats.wins),
            "total_score_accum": int(stats.total_score_accum),
            "rewards_atto": str(int(stats.rewards_atto)),
            "disqualifications": int(stats.disqualifications),
        }

    @gl.public.view
    def get_reward_balance(self, address: str) -> str:
        key = Address(address).as_hex
        if key not in self.reward_balances_atto:
            return "0"
        return str(int(self.reward_balances_atto[key]))

    @gl.public.view
    def get_dispute(self, dispute_id: str) -> dict:
        if dispute_id not in self.disputes:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Dispute not found: {dispute_id}")
        d = self.disputes[dispute_id]
        return {
            "id": d.id,
            "submission_id": d.submission_id,
            "competition_id": d.competition_id,
            "opened_by": d.opened_by,
            "reason": d.reason,
            "evidence_url": d.evidence_url,
            "status": d.status,
            "verdict_summary": d.verdict_summary,
            "opened_at": d.opened_at,
            "resolved_at": d.resolved_at,
        }

    @gl.public.view
    def list_disputes(self, offset: int, limit: int) -> list:
        limit = max(1, min(50, limit))
        offset = max(0, offset)
        total = len(self.dispute_ids)
        out = []
        index = total - 1 - offset
        while index >= 0 and len(out) < limit:
            did = self.dispute_ids[index]
            d = self.disputes[did]
            out.append(
                {
                    "id": d.id,
                    "submission_id": d.submission_id,
                    "status": d.status,
                    "opened_at": d.opened_at,
                }
            )
            index -= 1
        return out

    @gl.public.view
    def get_audit_log_tail(self, count: int) -> list:
        """Return up to the last `count` audit events (capped at 100)."""
        count = max(1, min(100, count))
        total = len(self.audit_log)
        start = max(0, total - count)
        out = []
        for index in range(start, total):
            try:
                out.append(json.loads(self.audit_log[index]))
            except (ValueError, TypeError):
                out.append({"e": "unparseable"})
        return out
