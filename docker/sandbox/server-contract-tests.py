"""Offline contract checks for the dedicated Docker/proxy Server image.

Run against the patched source (PYTHONPATH=server) or in Dockerfile.server.
Every Docker interaction is mocked; these tests never create a sandbox.
"""

import json
import tempfile
import threading
import unittest
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from opensandbox_server.api.schema import CreateSandboxRequest, ImageSpec, NetworkPolicy
from opensandbox_server.config import (
    AppConfig,
    DockerConfig,
    EgressConfig,
    RuntimeConfig,
    ServerConfig,
)
from opensandbox_server.extensions.keys import (
    ACCESS_RENEW_EXTEND_SECONDS_KEY,
    ACCESS_RENEW_EXTEND_SECONDS_METADATA_KEY,
    ANNOTATION_METADATA_PREFIX,
    EXTENSIONS_ANNOTATION_PREFIX,
)
from opensandbox_server.services import constants
from opensandbox_server.services.docker import DockerSandboxService
from opensandbox_server.services.docker import port_allocator
from opensandbox_server.services.docker import docker_service
from opensandbox_server.services.docker.metadata import DockerMetadataStore
from opensandbox_server.services.docker.networking import EGRESS_SIDECAR_LABEL
from opensandbox_server.services.sandbox_service import SandboxService
from opensandbox_server.services.validators import ensure_metadata_labels


def config(**docker):
    return AppConfig(
        server=ServerConfig(host="192.0.2.10", port=8080),
        runtime=RuntimeConfig(type="docker", execd_image="example/execd:test"),
        docker=DockerConfig(**docker),
        egress=EgressConfig(image="example/egress:test", mode="dns+nft"),
    )


def service(**docker):
    # Avoid constructor startup recovery, worker threads and a real Docker socket.
    obj = object.__new__(DockerSandboxService)
    obj.app_config = config(**docker)
    obj.network_mode = obj.app_config.docker.network_mode
    obj.docker_client = MagicMock()
    return obj


class ServerContractTests(unittest.TestCase):
    def test_safe_defaults(self):
        self.assertEqual(DockerConfig().publish_host, "127.0.0.1")
        self.assertEqual(DockerConfig().network_mode, "bridge")

    def test_non_loopback_publish_rejected(self):
        for address in ("0.0.0.0", "192.0.2.10", "::1", "localhost", ""):
            with self.subTest(address=address), self.assertRaises(ValidationError):
                DockerConfig(publish_host=address)

    def test_ipv4_loopback_publish_supported(self):
        self.assertEqual(
            DockerConfig(publish_host="127.0.0.2").publish_host, "127.0.0.2"
        )

    def test_workload_network_cannot_bypass_isolation(self):
        for mode in ("host", "none", "container:other", "custom-bridge"):
            with self.subTest(mode=mode), self.assertRaises(ValidationError):
                DockerConfig(network_mode=mode)

    def test_kubernetes_rejected_by_dedicated_image(self):
        with self.assertRaisesRegex(ValidationError, "supports only"):
            AppConfig(
                server=ServerConfig(),
                runtime=RuntimeConfig(
                    type="kubernetes", execd_image="example/execd:test"
                ),
            )

    def test_proxy_explicit_host_overrides_control_plane_binding(self):
        self.assertEqual(
            service(host_ip="127.0.0.2")._resolve_proxy_host(), "127.0.0.2"
        )

    def test_proxy_default_uses_publish_target(self):
        self.assertEqual(service()._resolve_proxy_host(), "127.0.0.1")
        self.assertEqual(
            service(publish_host="127.0.0.2")._resolve_proxy_host(), "127.0.0.2"
        )

    def test_proxy_ignores_public_eip(self):
        obj = service()
        obj.app_config.server.eip = "198.51.100.10"
        self.assertEqual(obj._resolve_proxy_host(), "127.0.0.1")

    def test_port_probe_uses_publish_address(self):
        with patch.object(port_allocator.socket, "socket") as factory:
            with patch.object(port_allocator.random, "randint", return_value=45123):
                self.assertEqual(
                    port_allocator.allocate_host_port(publish_host="127.0.0.2"), 45123
                )
            factory.return_value.__enter__.return_value.bind.assert_called_once_with(
                ("127.0.0.2", 45123)
            )

    def test_all_ports_including_udp_and_egress_use_loopback(self):
        ports = ["44772", "8080", "18080", "3389/tcp", "3389/udp", "8006/tcp"]
        with patch.object(
            port_allocator, "allocate_host_port", side_effect=range(45000, 45006)
        ) as allocate:
            bindings = port_allocator.allocate_port_bindings(
                ports, publish_host="127.0.0.2"
            )
        self.assertEqual(set(bindings), set(ports))
        self.assertTrue(all(host == "127.0.0.2" for host, _ in bindings.values()))
        self.assertTrue(
            all(
                call.kwargs["publish_host"] == "127.0.0.2"
                for call in allocate.call_args_list
            )
        )

    def test_sidecar_binds_core_and_extra_ports_on_loopback(self):
        obj = service(publish_host="127.0.0.2")
        obj._ensure_image_available = MagicMock()
        obj._docker_operation = lambda *args: nullcontext()
        obj.docker_client.api.create_container.return_value = {"Id": "sidecar"}
        obj._start_egress_sidecar(
            "sandbox",
            NetworkPolicy(defaultAction="deny"),
            "test-token",
            45000,
            45001,
            extra_port_bindings={
                "18080": ("127.0.0.2", 45002),
                "3389/udp": ("127.0.0.2", 45003),
            },
        )
        bindings = obj.docker_client.api.create_host_config.call_args.kwargs[
            "port_bindings"
        ]
        self.assertEqual(set(bindings), {"44772", "8080", "18080", "3389/udp"})
        self.assertTrue(all(host == "127.0.0.2" for host, _ in bindings.values()))
        labels = obj.docker_client.api.create_container.call_args.kwargs["labels"]
        self.assertEqual(labels, {EGRESS_SIDECAR_LABEL: "sandbox"})
        self.assertNotIn("opensandbox.io/egress-sidecar-for", labels)

    def _check_provision_bindings(self, with_egress):
        obj = service(publish_host="127.0.0.2")
        obj._build_labels_and_env = MagicMock(return_value=({}, []))
        obj._resolve_image_auth = MagicMock(
            return_value=("example/workload:test", None)
        )
        obj._resolve_resource_limits = MagicMock(return_value=(None, None, None))
        obj._prepare_ossfs_mounts = MagicMock(return_value=[])
        obj._build_volume_binds = MagicMock(return_value=[])
        obj._base_host_config_kwargs = MagicMock(return_value={})
        obj._docker_operation = lambda *args: nullcontext()
        obj._start_egress_sidecar = MagicMock(return_value=MagicMock(id="sidecar"))
        obj._release_ossfs_mounts = MagicMock()
        obj._cleanup_managed_volumes = MagicMock()
        # Inspect the full provisioning intent immediately before any workload creation.
        obj._create_and_start_container = MagicMock(
            side_effect=RuntimeError("test boundary")
        )
        request = CreateSandboxRequest(
            image=ImageSpec(uri="example/workload:test"),
            entrypoint=["sleep", "60"],
            timeout=60,
            resourceLimits={"cpu": "1", "memory": "512Mi"},
            networkPolicy=NetworkPolicy(defaultAction="deny") if with_egress else None,
        )

        def allocate(ports, **kwargs):
            self.assertEqual(kwargs["publish_host"], "127.0.0.2")
            return {
                port: (kwargs["publish_host"], 45000 + index)
                for index, port in enumerate(ports)
            }

        with patch.object(
            docker_service, "allocate_port_bindings", side_effect=allocate
        ) as alloc:
            with self.assertRaisesRegex(RuntimeError, "test boundary"):
                obj._provision_sandbox(
                    "sandbox", request, datetime.now(timezone.utc), None
                )
        self.assertEqual(
            alloc.call_args.args[0],
            ["44772", "8080", "18080"] if with_egress else ["44772", "8080"],
        )
        if with_egress:
            self.assertEqual(
                obj._start_egress_sidecar.call_args.kwargs["extra_port_bindings"],
                {"18080": ("127.0.0.2", 45002)},
            )
        else:
            bindings = obj._create_and_start_container.call_args.args[5][
                "port_bindings"
            ]
            self.assertEqual(
                bindings, {"44772": ("127.0.0.2", 45000), "8080": ("127.0.0.2", 45001)}
            )

    def test_provision_without_egress_uses_configured_publish_host(self):
        self._check_provision_bindings(False)

    def test_provision_with_egress_uses_configured_publish_host(self):
        self._check_provision_bindings(True)

    def test_internal_keys_use_owned_namespace(self):
        values = [
            value
            for name, value in vars(constants).items()
            if name.startswith("SANDBOX_") and isinstance(value, str)
        ]
        self.assertEqual(len(values), 12)
        self.assertTrue(all(value.startswith("io.antcdp.sandbox/") for value in values))
        self.assertTrue(EGRESS_SIDECAR_LABEL.startswith("io.antcdp.sandbox/"))

    def test_create_rejects_both_reserved_prefixes(self):
        for prefix in constants.RESERVED_LABEL_PREFIXES:
            with (
                self.subTest(prefix=prefix),
                self.assertRaises(HTTPException) as caught,
            ):
                ensure_metadata_labels({prefix + "id": "sandbox"})
            self.assertEqual(caught.exception.status_code, 400)

    def test_patch_rejects_both_reserved_prefixes_including_deletion(self):
        obj = service()
        obj._get_container_by_sandbox_id = MagicMock(return_value=MagicMock(attrs={}))
        obj._metadata_store = MagicMock()
        for prefix in constants.RESERVED_LABEL_PREFIXES:
            for value in (None, "sandbox"):
                with (
                    self.subTest(prefix=prefix, value=value),
                    self.assertRaises(HTTPException),
                ):
                    obj.patch_sandbox_metadata("sandbox", {prefix + "id": value})
                with self.assertRaises(HTTPException):
                    SandboxService._apply_metadata_patch({}, {prefix + "id": value})
        obj._metadata_store.patch.assert_not_called()

    def test_client_metadata_remains_unchanged(self):
        metadata = {"antcdp_installation_id": "a" * 32, "antcdp_workspace_id": "42"}
        ensure_metadata_labels(metadata)
        self.assertEqual(SandboxService._apply_metadata_patch({}, metadata), metadata)

    def test_metadata_hides_both_namespaces(self):
        labels = {
            prefix + "secure-access-token": "test-secret"
            for prefix in constants.RESERVED_LABEL_PREFIXES
        }
        labels["antcdp_workspace_id"] = "42"
        with tempfile.TemporaryDirectory() as root:
            store = DockerMetadataStore(Path(root))
            self.assertEqual(
                store.get("sandbox", labels), {"antcdp_workspace_id": "42"}
            )

    def test_persisted_metadata_also_hides_both_namespaces(self):
        with tempfile.TemporaryDirectory() as root:
            store = DockerMetadataStore(Path(root))
            path = store._sandbox_path("sandbox")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(
                    {
                        "opensandbox.io/id": "old",
                        "io.antcdp.sandbox/id": "new",
                        "visible": "yes",
                    }
                )
            )
            self.assertEqual(store.get("sandbox", {}), {"visible": "yes"})

    def test_extension_api_keys_unchanged_internal_keys_owned(self):
        self.assertEqual(ACCESS_RENEW_EXTEND_SECONDS_KEY, "access.renew.extend.seconds")
        self.assertEqual(EXTENSIONS_ANNOTATION_PREFIX, "opensandbox.extensions.")
        self.assertTrue(
            ACCESS_RENEW_EXTEND_SECONDS_METADATA_KEY.startswith("io.antcdp.sandbox/")
        )
        self.assertTrue(ANNOTATION_METADATA_PREFIX.startswith("io.antcdp.sandbox/"))

    def test_lookup_rejects_old_server_container_even_with_matching_name(self):
        obj = service()
        obj.docker_client.containers.get.return_value = MagicMock(
            attrs={"Config": {"Labels": {"opensandbox.io/id": "old"}}}
        )
        obj.docker_client.containers.list.return_value = []
        with self.assertRaises(HTTPException) as caught:
            obj._get_container_by_sandbox_id("old")
        self.assertEqual(caught.exception.status_code, 404)
        obj.docker_client.containers.list.assert_called_once_with(
            all=True, filters={"label": "io.antcdp.sandbox/id=old"}
        )

    def test_restart_ignores_old_resources_but_restores_owned_sandbox(self):
        obj = service()
        expires = datetime.now(timezone.utc) + timedelta(hours=1)
        old_expired = {
            "opensandbox.io/id": "old",
            "opensandbox.io/expires-at": "2000-01-01T00:00:00Z",
        }
        old_sidecar = {"opensandbox.io/egress-sidecar-for": "old-orphan"}
        current = {constants.SANDBOX_ID_LABEL: "owned"}
        obj.docker_client.containers.list.return_value = [
            MagicMock(attrs={"Config": {"Labels": labels}})
            for labels in (old_expired, old_sidecar, current)
        ]
        obj._get_tracked_expiration = MagicMock(return_value=expires)
        obj._schedule_expiration = MagicMock()
        obj._expire_sandbox = MagicMock()
        obj._cleanup_egress_sidecar = MagicMock()
        obj._ossfs_mount_lock = threading.Lock()
        obj._restore_existing_sandboxes()
        obj._get_tracked_expiration.assert_called_once_with("owned", current)
        obj._schedule_expiration.assert_called_once_with("owned", expires)
        obj._expire_sandbox.assert_not_called()
        obj._cleanup_egress_sidecar.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
