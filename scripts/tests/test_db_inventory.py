"""在隔离 PostgreSQL 中执行真实盘点函数，覆盖升级前后的列结构。

运行：python -m unittest discover -s scripts/tests -p test_db_inventory.py -v
需要本机已有 postgres:16-alpine 镜像；不会联网或连接业务数据库。
"""

import os
import re
import subprocess
import time
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def record_id(value: int) -> str:
    return str(uuid.UUID(int=value))


class DatabaseInventoryTests(unittest.TestCase):
    container_name: str

    @classmethod
    def docker(cls, *args: str, **kwargs) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["docker", *args], text=True, capture_output=True, timeout=30, **kwargs,
        )

    @classmethod
    def setUpClass(cls) -> None:
        cls.container_name = "trace-ship-inventory-test-" + uuid.uuid4().hex[:12]
        result = cls.docker(
            "run", "-d", "--pull=never", "--name", cls.container_name,
            "--network", "none", "--tmpfs", "/var/lib/postgresql/data",
            "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16-alpine",
        )
        if result.returncode:
            raise RuntimeError(result.stderr)
        cls.addClassCleanup(cls.remove_container)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            logs = cls.docker("logs", cls.container_name)
            # 初始化用的临时服务器也会报告 ready，须等最终服务器启动。
            if "PostgreSQL init process complete" in logs.stdout:
                ready = cls.docker("exec", cls.container_name, "pg_isready", "-U", "postgres")
                if ready.returncode == 0:
                    return
            time.sleep(0.1)
        raise RuntimeError("隔离 PostgreSQL 启动超时")

    @classmethod
    def remove_container(cls) -> None:
        result = cls.docker("rm", "-fv", cls.container_name)
        if result.returncode:
            raise RuntimeError("隔离容器清理失败：" + result.stderr)

    def execute(self, sql: str) -> str:
        result = self.docker(
            "exec", "-i", self.container_name, "psql", "-X", "-U", "postgres",
            "-v", "ON_ERROR_STOP=1", "-qAt", input=sql,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def setUp(self) -> None:
        # 只保留盘点依赖的列，不加物理身份唯一约束，以覆盖升级前重复数据。
        self.execute("""
            DROP SCHEMA public CASCADE;
            CREATE SCHEMA public;
            CREATE TABLE sys_repo (
                id uuid PRIMARY KEY, name text, vendor text, url text,
                external_identity text, repo_type text, created_at timestamptz
            );
            CREATE TABLE sys_project (id uuid PRIMARY KEY, name text);
            CREATE TABLE release_record (repository_id uuid);
        """)

    def create_current_schema(self) -> None:
        self.create_components()
        self.execute("CREATE TABLE package_config (project_component_id uuid);")

    def create_components(self) -> None:
        self.execute("""
            CREATE TABLE project_component (
                id uuid PRIMARY KEY, project_id uuid, repository_id uuid
            );
        """)

    def create_legacy_schema(self) -> None:
        self.execute("""
            ALTER TABLE sys_repo ADD COLUMN project_id uuid;
            CREATE TABLE package_config (repository_id uuid);
        """)

    def seed_duplicates(self) -> None:
        self.execute(f"""
            INSERT INTO sys_repo (id, name, vendor, url, external_identity, repo_type, created_at)
            VALUES ('{record_id(1)}', '仓库甲', 'gitlab', 'https://gitlab.example.test', '42', 'git', '2026-01-01'),
                   ('{record_id(2)}', '仓库乙', 'gitlab', 'https://gitlab.example.test', '42', 'git', '2026-01-02');
            INSERT INTO sys_project VALUES ('{record_id(100)}', '项目A'), ('{record_id(101)}', '项目B');
            INSERT INTO release_record VALUES ('{record_id(1)}'), ('{record_id(1)}'), ('{record_id(2)}');
        """)

    def inventory(self) -> subprocess.CompletedProcess[str]:
        script = (ROOT / "scripts/db.sh").read_text(encoding="utf-8")
        function = re.search(r"^sql_inventory\(\) \{\n.*?^\}", script, re.MULTILINE | re.DOTALL)
        self.assertIsNotNone(function, "未找到真实盘点函数")
        # 仅替换数据库连接边界；SQL、psql 元命令与错误处理均用生产实现。
        wrapper = r"""
set -e
psql_exec() {
    docker exec -i -e 'PGOPTIONS=-c default_transaction_read_only=on' \
        "$TRACE_SHIP_INVENTORY_TEST_CONTAINER" \
        psql -X -U postgres -v ON_ERROR_STOP=1 -qAt -F $'\t' "$@"
}
"""
        return subprocess.run(
            ["bash"], input=wrapper + function.group(0) + "\nsql_inventory\n", text=True,
            capture_output=True, timeout=30,
            env={**os.environ, "TRACE_SHIP_INVENTORY_TEST_CONTAINER": self.container_name},
        )

    def duplicate_rows(self, output: str) -> dict[str, list[str]]:
        rows = [line.split("\t") for line in output.splitlines() if line.startswith("42\t")]
        self.assertEqual(len(rows), 2, output)
        return {row[1]: row for row in rows}

    def test_current_schema_with_35_distinct_repositories(self) -> None:
        """没有重复行也必须能解析明细查询，不得引用已删字段。"""
        self.create_current_schema()
        self.execute("""
            INSERT INTO sys_repo
            SELECT lpad(to_hex(i), 32, '0')::uuid, '仓库' || i, 'gitlab',
                   'https://gitlab.example.test', i::text, 'git', NOW()
            FROM generate_series(1, 35) i;
        """)
        result = self.inventory()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("\n35\n", result.stdout)
        self.assertIn("Git 仓库缺少 external_identity:", result.stdout)
        self.assertIn("project_component", result.stdout)

    def test_legacy_schema_keeps_projects_and_counts(self) -> None:
        self.create_legacy_schema()
        self.seed_duplicates()
        self.execute(f"""
            UPDATE sys_repo SET project_id = '{record_id(100)}' WHERE id = '{record_id(1)}';
            INSERT INTO package_config VALUES ('{record_id(1)}'), ('{record_id(1)}');
        """)
        result = self.inventory()
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = self.duplicate_rows(result.stdout)
        self.assertEqual(rows[record_id(1)][3], "项目A")
        self.assertEqual(rows[record_id(1)][5:], ["2", "2"])
        self.assertEqual(rows[record_id(2)][3], "")
        self.assertEqual(rows[record_id(2)][5:], ["1", "0"])

    def test_current_schema_lists_all_projects_without_inflating_counts(self) -> None:
        self.create_current_schema()
        self.seed_duplicates()
        self.execute(f"""
            INSERT INTO project_component VALUES
                ('{record_id(1000)}', '{record_id(100)}', '{record_id(1)}'),
                ('{record_id(1001)}', '{record_id(100)}', '{record_id(1)}'),
                ('{record_id(1002)}', '{record_id(101)}', '{record_id(1)}');
            INSERT INTO package_config VALUES
                ('{record_id(1000)}'), ('{record_id(1000)}'), ('{record_id(1002)}');
        """)
        result = self.inventory()
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = self.duplicate_rows(result.stdout)
        self.assertEqual(rows[record_id(1)][3], "项目A、项目B")
        self.assertEqual(rows[record_id(1)][5:], ["2", "3"])
        self.assertEqual(rows[record_id(2)][3], "")
        self.assertEqual(rows[record_id(2)][5:], ["1", "0"])

    def test_transition_schema_uses_components_and_legacy_config_count(self) -> None:
        self.create_legacy_schema()
        self.create_components()
        self.seed_duplicates()
        self.execute(f"""
            ALTER TABLE package_config ADD COLUMN product_component_id uuid;
            UPDATE sys_repo SET project_id = '{record_id(100)}' WHERE id = '{record_id(1)}';
            INSERT INTO project_component VALUES ('{record_id(1000)}', '{record_id(101)}', '{record_id(1)}');
            INSERT INTO package_config (repository_id) VALUES ('{record_id(1)}'), ('{record_id(1)}');
        """)
        result = self.inventory()
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = self.duplicate_rows(result.stdout)
        self.assertEqual(rows[record_id(1)][3], "项目B")
        self.assertEqual(rows[record_id(1)][5:], ["2", "2"])

    def test_query_errors_keep_nonzero_exit_code(self) -> None:
        self.create_current_schema()
        self.execute("DROP TABLE release_record;")
        result = self.inventory()
        self.assertEqual(result.returncode, 3)
        self.assertIn('relation "release_record" does not exist', result.stderr)


if __name__ == "__main__":
    unittest.main()
