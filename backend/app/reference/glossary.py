"""Vietnamese -> English system-design glossary (pilot, no LLM).

The SysDesAi corpus is English. A Vietnamese query is folded (no diacritics,
lowercase), then scanned left to right for the LONGEST glossary phrase at each
position; a hit is replaced by its English terms, anything else is kept as a
token unless it is a stopword. So ``bộ nhớ đệm cho chuyển hướng link rút gọn``
becomes ``cache redirect "url shortener"``.

Keys are written WITH diacritics for review by a Vietnamese reader and folded
at import time, so both "bộ nhớ đệm" and "bo nho dem" hit the same entry.
Single-syllable Vietnamese keys are avoided on purpose: folded, they collide
with English words or with unrelated Vietnamese words ("luồng"/"lương").

Values are English terms; a multi-word term is searched as a phrase AND as its
separate words (see search.build_fts_query). Every value must be plain
``[a-z0-9 ]`` - enforced below, because the FTS query builder quotes them.

Adding an entry: one line, ``"tiếng việt": ("english term", ...)``. A test
(tests/test_reference_textnorm.py) checks there are >= 100 phrases and no two
keys fold to the same string with different meanings.
"""

from __future__ import annotations

import re

from .textnorm import fold, tokens

_RAW_GLOSSARY: dict[str, tuple[str, ...]] = {
    # --- Classic interview systems -------------------------------------------
    "rút gọn link": ("url shortener",),
    "rút gọn url": ("url shortener",),
    "rút gọn đường dẫn": ("url shortener",),
    "rút gọn liên kết": ("url shortener",),
    "link rút gọn": ("url shortener",),
    "url rút gọn": ("url shortener",),
    "đường dẫn rút gọn": ("url shortener",),
    "liên kết rút gọn": ("url shortener",),
    "bitly": ("url shortener",),
    "tinyurl": ("url shortener",),
    "nhắn tin": ("messaging", "chat"),
    "tin nhắn": ("message", "chat"),
    "trò chuyện": ("chat", "messaging"),
    "ứng dụng chat": ("chat", "messaging"),
    "thông báo": ("notification",),
    "thông báo đẩy": ("push notification",),
    "đẩy thông báo": ("push notification",),
    "tìm kiếm": ("search",),
    "tìm kiếm toàn văn": ("full text search",),
    "công cụ tìm kiếm": ("search engine",),
    "máy tìm kiếm": ("search engine",),
    "tự động hoàn thành": ("autocomplete", "typeahead"),
    "gợi ý từ khóa": ("autocomplete", "typeahead"),
    "gợi ý tìm kiếm": ("autocomplete", "typeahead"),
    "thu thập dữ liệu web": ("web crawler",),
    "trình thu thập web": ("web crawler",),
    "cào dữ liệu": ("web crawler", "scraping"),
    "đặt xe": ("ride sharing", "ride hailing"),
    "gọi xe": ("ride sharing", "ride hailing"),
    "đi chung xe": ("ride sharing",),
    "chia sẻ chuyến đi": ("ride sharing",),
    "tài xế": ("driver",),
    "hành khách": ("rider", "passenger"),
    "chuyến đi": ("trip",),
    "ghép chuyến": ("matching",),
    "phát video": ("video streaming",),
    "truyền phát video": ("video streaming",),
    "xem video": ("video streaming",),
    "chia sẻ video": ("video sharing", "video streaming"),
    "phát trực tiếp": ("live streaming",),
    "truyền hình trực tiếp": ("live streaming",),
    "phát nhạc": ("music streaming",),
    "nghe nhạc": ("music streaming",),
    "gợi ý": ("recommendation",),
    "đề xuất": ("recommendation",),
    "khuyến nghị": ("recommendation",),
    "hệ thống gợi ý": ("recommendation system",),
    "mạng xã hội": ("social network", "social media"),
    "bảng tin": ("news feed", "timeline"),
    "dòng thời gian": ("timeline", "news feed"),
    "bình luận": ("comment",),
    "lượt thích": ("like",),
    "người theo dõi": ("follower",),
    "chia sẻ ảnh": ("photo sharing", "image"),
    "hình ảnh": ("image", "photo"),
    "thương mại điện tử": ("e commerce", "ecommerce"),
    "mua sắm trực tuyến": ("e commerce", "online shopping"),
    "giỏ hàng": ("shopping cart", "cart"),
    "đơn hàng": ("order",),
    "đặt hàng": ("order", "checkout"),
    "quản lý đơn hàng": ("order management",),
    "tồn kho": ("inventory",),
    "kho hàng": ("inventory", "warehouse"),
    "danh mục sản phẩm": ("product catalog",),
    "định giá động": ("dynamic pricing", "surge pricing"),
    "mã giảm giá": ("coupon", "promotion"),
    "khuyến mãi": ("promotion", "coupon"),
    "quảng cáo": ("advertising", "ads"),
    "lượt nhấp": ("click",),
    "nhấp chuột": ("click",),
    "đặt chỗ": ("booking", "reservation"),
    "đặt phòng": ("hotel booking", "reservation"),
    "đặt vé": ("ticket booking", "ticketing"),
    "khách sạn": ("hotel",),
    "nhà hàng": ("restaurant",),
    "giao hàng": ("delivery",),
    "giao đồ ăn": ("food delivery",),
    "đặt đồ ăn": ("food delivery", "food ordering"),
    "đấu giá": ("auction",),
    "sàn giao dịch": ("exchange", "trading"),
    "chứng khoán": ("stock trading", "stock exchange"),
    "khớp lệnh": ("order matching", "matching engine"),
    "sổ lệnh": ("order book",),
    "tiền mã hóa": ("cryptocurrency", "crypto"),
    "chuỗi khối": ("blockchain",),
    "bản đồ": ("maps",),
    "định vị": ("location", "geolocation"),
    "vị trí": ("location",),
    "theo dõi vị trí": ("location tracking",),
    "tìm đường": ("routing", "navigation"),
    "gọi video": ("video call", "video conferencing"),
    "hội nghị truyền hình": ("video conferencing",),
    "soạn thảo cộng tác": ("collaborative editing",),
    "chỉnh sửa cộng tác": ("collaborative editing",),
    "cộng tác thời gian thực": ("collaborative editing", "real time"),
    "bảng xếp hạng": ("leaderboard", "ranking"),
    "xếp hạng": ("ranking",),
    "thịnh hành": ("trending", "top k"),
    "xu hướng": ("trending",),
    "bỏ phiếu": ("voting", "poll"),
    "bình chọn": ("voting", "poll"),
    "kiểm duyệt nội dung": ("content moderation",),
    "quản lý nội dung": ("content management", "cms"),
    "trò chơi trực tuyến": ("online gaming", "game"),
    "trò chơi": ("game", "gaming"),
    "học trực tuyến": ("online learning", "e learning"),
    "y tế": ("healthcare",),
    "bệnh viện": ("hospital", "healthcare"),
    "ứng dụng di động": ("mobile app",),
    "điện thoại di động": ("mobile",),
    "cảm biến": ("sensor", "iot"),
    "học máy": ("machine learning",),
    "máy học": ("machine learning",),
    "trí tuệ nhân tạo": ("artificial intelligence", "ai"),
    "mô hình ngôn ngữ lớn": ("large language model", "llm"),
    "nhận diện khuôn mặt": ("face recognition",),
    "dịch thuật": ("translation",),
    # --- Payments, billing, identity ----------------------------------------
    "thanh toán": ("payment",),
    "cổng thanh toán": ("payment gateway",),
    "ví điện tử": ("digital wallet", "payment"),
    "chuyển tiền": ("money transfer", "payment"),
    "ngân hàng": ("banking", "bank"),
    "hóa đơn": ("invoice", "billing"),
    "tính cước": ("billing",),
    "thanh toán định kỳ": ("subscription", "recurring payment"),
    "phát hiện gian lận": ("fraud detection",),
    "chống gian lận": ("fraud detection",),
    "xác thực": ("authentication",),
    "phân quyền": ("authorization", "access control"),
    "ủy quyền": ("authorization",),
    "đăng nhập": ("login", "authentication"),
    "đăng nhập một lần": ("single sign on", "sso"),
    "quản lý phiên": ("session management",),
    "người dùng": ("user",),
    "hồ sơ người dùng": ("user profile",),
    "mã hóa": ("encryption",),
    "bảo mật": ("security",),
    "tường lửa": ("firewall",),
    # --- Building blocks ----------------------------------------------------
    "bộ nhớ đệm": ("cache",),
    "bộ đệm": ("cache", "buffer"),
    "lưu đệm": ("cache",),
    "bộ nhớ tạm": ("cache",),
    "bộ nhớ trong": ("in memory",),
    "cân bằng tải": ("load balancer", "load balancing"),
    "bộ cân bằng tải": ("load balancer",),
    "hàng đợi": ("queue",),
    "hàng đợi tin nhắn": ("message queue",),
    "hàng đợi tác vụ": ("task queue", "job queue"),
    "hàng đợi thư chết": ("dead letter queue",),
    "môi giới tin nhắn": ("message broker",),
    "xuất bản đăng ký": ("pub sub",),
    "cơ sở dữ liệu": ("database",),
    "csdl": ("database",),
    "cơ sở dữ liệu quan hệ": ("relational database", "sql"),
    "cơ sở dữ liệu phân tán": ("distributed database",),
    "cơ sở dữ liệu đồ thị": ("graph database",),
    "chuỗi thời gian": ("time series",),
    "kho khóa giá trị": ("key value store",),
    "khóa giá trị": ("key value",),
    "lưu trữ": ("storage",),
    "lưu trữ đối tượng": ("object storage", "blob storage"),
    "lưu trữ tệp": ("file storage",),
    "lưu trữ file": ("file storage",),
    "lưu trữ đám mây": ("cloud storage",),
    "chia sẻ tệp": ("file sharing",),
    "chia sẻ file": ("file sharing",),
    "tải lên": ("upload",),
    "tải xuống": ("download",),
    "đồng bộ": ("sync", "synchronization"),
    "đồng bộ hóa": ("sync", "synchronization"),
    "bất đồng bộ": ("asynchronous", "async"),
    "chỉ mục": ("index",),
    "đánh chỉ mục": ("indexing",),
    "truy vấn": ("query",),
    "lược đồ": ("schema",),
    "mô hình dữ liệu": ("data model", "schema"),
    "khóa chính": ("primary key",),
    "bản sao đọc": ("read replica",),
    "tỉ lệ đọc ghi": ("read write ratio",),
    "tỷ lệ đọc ghi": ("read write ratio",),
    "phân mảnh": ("sharding",),
    "phân mảnh dữ liệu": ("sharding",),
    "phân vùng": ("partitioning",),
    "nhân bản": ("replication",),
    "sao chép dữ liệu": ("replication",),
    "sao lưu": ("backup",),
    "khôi phục": ("recovery", "restore"),
    "khôi phục thảm họa": ("disaster recovery",),
    "di chuyển dữ liệu": ("data migration",),
    "giới hạn tốc độ": ("rate limiting", "rate limiter"),
    "giới hạn tần suất": ("rate limiting",),
    "giới hạn truy cập": ("rate limiting",),
    "giới hạn lưu lượng": ("rate limiting", "throttling"),
    "chuyển hướng": ("redirect",),
    "mã băm": ("hash", "hashing"),
    "hàm băm": ("hash", "hashing"),
    "băm nhất quán": ("consistent hashing",),
    "bộ lọc bloom": ("bloom filter",),
    "định danh duy nhất": ("unique id", "id generator"),
    "sinh mã định danh": ("unique id", "id generator"),
    "proxy ngược": ("reverse proxy",),
    "cổng api": ("api gateway",),
    "mạng phân phối nội dung": ("cdn", "content delivery network"),
    "phân giải tên miền": ("dns",),
    "tên miền": ("dns", "domain"),
    "máy chủ": ("server",),
    "máy chủ web": ("web server",),
    "cụm máy chủ": ("cluster",),
    "trung tâm dữ liệu": ("data center",),
    "đa vùng": ("multi region",),
    "đám mây": ("cloud",),
    "máy ảo": ("virtual machine",),
    "ảo hóa": ("virtualization",),
    "điều phối container": ("container orchestration", "kubernetes"),
    "triển khai": ("deployment",),
    "kết nối thời gian thực": ("websocket", "real time"),
    "trạng thái trực tuyến": ("presence", "online status"),
    "điểm cuối": ("endpoint",),
    "lập lịch tác vụ": ("job scheduler", "scheduling"),
    "bộ lập lịch": ("scheduler",),
    "đặt lịch": ("scheduling", "calendar"),
    "tác vụ nền": ("background job",),
    "thư điện tử": ("email",),
    "gửi email": ("email",),
    "đếm lượt xem": ("view counter", "view count"),
    "bộ đếm lượt": ("counter",),
    "nén dữ liệu": ("compression",),
    "nén video": ("video compression", "compression"),
    "chuyển mã video": ("video transcoding",),
    "ngắt mạch": ("circuit breaker",),
    "thử lại": ("retry",),
    "lũy đẳng": ("idempotency", "idempotent"),
    "khóa phân tán": ("distributed lock",),
    "khóa lạc quan": ("optimistic locking",),
    "nhật ký ghi trước": ("write ahead log",),
    # --- Qualities and architecture vocabulary -----------------------------
    "hệ thống": ("system",),
    "thiết kế hệ thống": ("system design",),
    "hệ thống phân tán": ("distributed system",),
    "phân tán": ("distributed",),
    "kiến trúc": ("architecture",),
    "vi dịch vụ": ("microservices",),
    "kiến trúc vi dịch vụ": ("microservices",),
    "nguyên khối": ("monolith",),
    "hướng sự kiện": ("event driven",),
    "kiến trúc hướng sự kiện": ("event driven architecture",),
    "sự kiện": ("event",),
    "giao dịch": ("transaction",),
    "giao dịch phân tán": ("distributed transaction", "saga"),
    "nhất quán": ("consistency",),
    "tính nhất quán": ("consistency",),
    "nhất quán cuối cùng": ("eventual consistency",),
    "khả năng mở rộng": ("scalability", "scaling"),
    "mở rộng": ("scaling", "scalability"),
    "mở rộng theo chiều ngang": ("horizontal scaling",),
    "mở rộng theo chiều dọc": ("vertical scaling",),
    "tự động mở rộng": ("autoscaling", "auto scaling"),
    "sẵn sàng cao": ("high availability",),
    "tính sẵn sàng cao": ("high availability",),
    "tính sẵn sàng": ("availability",),
    "chịu lỗi": ("fault tolerance",),
    "khả năng chịu lỗi": ("fault tolerance",),
    "dự phòng": ("redundancy", "failover"),
    "chuyển đổi dự phòng": ("failover",),
    "độ trễ": ("latency",),
    "độ trễ thấp": ("low latency",),
    "thông lượng": ("throughput",),
    "băng thông": ("bandwidth",),
    "dung lượng": ("capacity", "storage"),
    "ước tính dung lượng": ("capacity estimation",),
    "ước lượng": ("estimation", "estimate"),
    "hiệu năng": ("performance",),
    "hiệu suất": ("performance",),
    "thời gian thực": ("real time",),
    "xử lý luồng": ("stream processing",),
    "luồng dữ liệu": ("data stream", "streaming"),
    "xử lý theo lô": ("batch processing",),
    "xử lý lô": ("batch processing",),
    "đường ống dữ liệu": ("data pipeline",),
    "kho dữ liệu": ("data warehouse",),
    "hồ dữ liệu": ("data lake",),
    "phân tích dữ liệu": ("analytics", "data analytics"),
    "phân tích": ("analytics",),
    "giám sát": ("monitoring",),
    "kiểm tra sức khỏe": ("health check",),
    "ghi log": ("logging",),
    "nhật ký hệ thống": ("logging", "log"),
    "cảnh báo": ("alert", "alerting"),
    "chỉ số": ("metrics",),
    "truy vết phân tán": ("distributed tracing",),
    "bảng điều khiển": ("dashboard",),
    "báo cáo": ("report", "reporting"),
    "yêu cầu chức năng": ("functional requirements",),
    "yêu cầu phi chức năng": ("non functional requirements",),
    "luồng xử lý": ("flow", "workflow"),
    "quy trình": ("workflow", "process"),
    "máy trạng thái": ("state machine",),
    "phiên bản": ("version", "versioning"),
}

_TERM_RE = re.compile(r"^[a-z0-9]+(?: [a-z0-9]+)*$")
MAX_PHRASE_TOKENS = 6


def _build() -> dict[str, tuple[str, ...]]:
    built: dict[str, tuple[str, ...]] = {}
    for raw_key, terms in _RAW_GLOSSARY.items():
        key = " ".join(tokens(raw_key))
        if not key:
            raise ValueError(f"glossary key {raw_key!r} folds to nothing")
        if len(key.split()) > MAX_PHRASE_TOKENS:
            raise ValueError(f"glossary key {raw_key!r} is longer than {MAX_PHRASE_TOKENS} tokens")
        for term in terms:
            if not _TERM_RE.match(term):
                raise ValueError(f"glossary term {term!r} must be lowercase [a-z0-9 ] words")
        if key in built and built[key] != terms:
            raise ValueError(f"glossary keys fold to the same {key!r} with different meanings")
        built[key] = terms
    return built


GLOSSARY: dict[str, tuple[str, ...]] = _build()


def phrase_count() -> int:
    return len(GLOSSARY)


def translate_tokens(folded_tokens: list[str]) -> list[tuple[str, tuple[str, ...] | None]]:
    """Greedy longest-match. Returns ``[(source, english_terms_or_None), ...]``.

    ``source`` is the folded phrase (or single token) consumed; ``None`` means
    no glossary entry matched and the token stands for itself.
    """
    out: list[tuple[str, tuple[str, ...] | None]] = []
    i = 0
    n = len(folded_tokens)
    while i < n:
        matched = False
        for width in range(min(MAX_PHRASE_TOKENS, n - i), 0, -1):
            key = " ".join(folded_tokens[i : i + width])
            terms = GLOSSARY.get(key)
            if terms is not None:
                out.append((key, terms))
                i += width
                matched = True
                break
        if not matched:
            out.append((folded_tokens[i], None))
            i += 1
    return out


def fold_key(text: str) -> str:
    """Exposed for tests: the folded form a glossary key is stored under."""
    return " ".join(tokens(fold(text)))
