import os
from pathlib import Path

import pymysql
import redis


ROOT = Path(__file__).resolve().parents[1]
SQL_PATH = ROOT / "database" / "init_mysql.sql"


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def split_sql(script: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single = False
    in_double = False
    escape = False

    for char in script:
        current.append(char)
        if escape:
            escape = False
            continue
        if char == "\\":
            escape = True
            continue
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif char == ";" and not in_single and not in_double:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement[:-1].strip())
            current = []

    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return [stmt for stmt in statements if stmt and not stmt.startswith("--")]


def init_mysql() -> int:
    connection = pymysql.connect(
        host=env("TP_MYSQL_HOST"),
        port=int(env("TP_MYSQL_PORT", "3306")),
        user=env("TP_MYSQL_USER"),
        password=env("TP_MYSQL_PASSWORD"),
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=10,
        read_timeout=60,
        write_timeout=60,
    )
    script = SQL_PATH.read_text(encoding="utf-8")
    statements = split_sql(script)
    with connection:
        with connection.cursor() as cursor:
            for statement in statements:
                cursor.execute(statement)
            cursor.execute(
                """
                SELECT COUNT(*)
                FROM information_schema.tables
                WHERE table_schema = 'test_platform'
                """
            )
            table_count = int(cursor.fetchone()[0])
    return table_count


def init_redis() -> str:
    client = redis.Redis(
        host=env("TP_REDIS_HOST"),
        port=int(env("TP_REDIS_PORT", "6379")),
        password=env("TP_REDIS_PASSWORD"),
        decode_responses=True,
        socket_connect_timeout=10,
        socket_timeout=10,
    )
    client.ping()
    client.set("test-platform:meta:schema_version", "2026.04.13")
    client.set("test-platform:meta:mysql_database", "test_platform")
    return client.get("test-platform:meta:schema_version") or ""


def main() -> None:
    table_count = init_mysql()
    redis_version = init_redis()
    print(f"MySQL initialized: test_platform tables={table_count}")
    print(f"Redis initialized: schema_version={redis_version}")


if __name__ == "__main__":
    main()
