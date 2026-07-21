import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from simulator import Request, build_workload, load_config, simulate  # noqa: E402


class SimulatorTest(unittest.TestCase):
    def test_mixed_workload_is_deterministic(self) -> None:
        first = simulate(build_workload("mixed"), load_config())
        second = simulate(build_workload("mixed"), load_config())
        self.assertEqual(first, second)
        self.assertEqual(first.request_count, 10)

    def test_write_heavy_is_slower_than_read_heavy(self) -> None:
        read_result = simulate(build_workload("read-heavy"), load_config())
        write_result = simulate(build_workload("write-heavy"), load_config())
        self.assertGreater(
            write_result.average_latency_us,
            read_result.average_latency_us,
        )

    def test_empty_workload_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least one"):
            simulate([], load_config())

    def test_throughput_never_exceeds_channel_limit(self) -> None:
        config = load_config()
        result = simulate(
            [Request("read", 4096, 1) for _ in range(100)],
            config,
        )
        self.assertLessEqual(
            result.throughput_mib_s,
            config["channels"] * config["channel_bandwidth_mib_s"],
        )


if __name__ == "__main__":
    unittest.main()
