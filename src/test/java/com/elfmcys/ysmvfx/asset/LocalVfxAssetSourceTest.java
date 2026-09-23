package com.elfmcys.ysmvfx.asset;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LocalVfxAssetSourceTest {
    @TempDir
    Path temp;

    @Test
    void validSnapshotIsImmutableAcrossReload() throws Exception {
        Path packs = temp.resolve("packs");
        writePack(packs, "first", "yesstevevfx:slash", "assets/eyelib/entity/slash.json");
        LocalVfxAssetSource source = new LocalVfxAssetSource(packs);

        Map<String, EffectAssetBundle> first = source.load();
        EffectAssetBundle oldBundle = first.get("yesstevevfx:slash");
        byte[] oldEntity = oldBundle.read("assets/eyelib/entity/slash.json");
        assertThrows(UnsupportedOperationException.class,
                () -> first.put("other", oldBundle));
        byte[] exposed = oldBundle.files().get("assets/eyelib/entity/slash.json");
        exposed[0] = 'x';
        assertArrayEquals(oldEntity, oldBundle.read("assets/eyelib/entity/slash.json"));

        Files.writeString(packs.resolve("first/effects/slash/effect.json"), effectJson(
                "yesstevevfx:slash", 24, "assets/eyelib/entity/slash.json"), StandardCharsets.UTF_8);
        Map<String, EffectAssetBundle> second = source.load();
        assertTrue(second != first);
        assertTrue(second.get("yesstevevfx:slash").definition().durationTicks() == 24);
        assertTrue(oldBundle.definition().durationTicks() == 100);
    }

    @Test
    void rejectsTraversalAndAbsoluteResourcePaths() throws Exception {
        Path packs = temp.resolve("packs");
        writePack(packs, "bad", "yesstevevfx:bad", "../outside.json");
        IOException error = assertThrows(IOException.class, () -> new LocalVfxAssetSource(packs).load());
        assertTrue(error.getMessage().contains("relative") || error.getMessage().contains(".."));
    }

    @Test
    void rejectsDuplicateEffectIdsAcrossPacks() throws Exception {
        Path packs = temp.resolve("packs");
        writePack(packs, "a", "yesstevevfx:same", "assets/eyelib/entity/a.json");
        writePack(packs, "b", "yesstevevfx:same", "assets/eyelib/entity/b.json");
        assertThrows(IOException.class, () -> new LocalVfxAssetSource(packs).load());
    }

    @Test
    void rejectsUnknownMetadataFields() throws Exception {
        Path packs = temp.resolve("packs");
        writePack(packs, "unknown", "yesstevevfx:unknown", "assets/eyelib/entity/u.json");
        Path effect = packs.resolve("unknown/effects/unknown/effect.json");
        Files.writeString(effect, effectJson("yesstevevfx:unknown", 20,
                "assets/eyelib/entity/u.json").replace("\"duration_ticks\":20", "\"duration_ticks\":20,\"future\":true"),
                StandardCharsets.UTF_8);
        assertThrows(IOException.class, () -> new LocalVfxAssetSource(packs).load());
    }

    @Test
    void pathValidationRejectsEmptyAndParentSegments() {
        assertThrows(IllegalArgumentException.class, () -> LocalVfxAssetSource.validateRelativePath(""));
        assertThrows(IllegalArgumentException.class, () -> LocalVfxAssetSource.validateRelativePath("a/../b"));
        assertThrows(IllegalArgumentException.class, () -> LocalVfxAssetSource.validateRelativePath("C:/outside"));
        assertDoesNotThrow(() -> LocalVfxAssetSource.validateRelativePath("assets/eyelib/entity/a.json"));
    }

    private static void writePack(Path packs, String pack, String id, String clientEntity) throws IOException {
        Path root = packs.resolve(pack);
        Files.createDirectories(root.resolve("effects/" + id.substring(id.indexOf(':') + 1)));
        Files.createDirectories(root.resolve("assets/eyelib/entity"));
        Files.writeString(root.resolve("manifest.json"), "{\"format_version\":1,\"pack_id\":\"" + pack +
                "\",\"effects\":[\"effects/" + id.substring(id.indexOf(':') + 1) + "/effect.json\"]}",
                StandardCharsets.UTF_8);
        Files.writeString(root.resolve("effects/" + id.substring(id.indexOf(':') + 1) + "/effect.json"),
                effectJson(id, 100, clientEntity), StandardCharsets.UTF_8);
        Files.write(root.resolve(clientEntity), "entity".getBytes(StandardCharsets.UTF_8));
    }

    private static String effectJson(String id, int duration, String clientEntity) {
        return "{\"format_version\":1,\"id\":\"" + id + "\",\"duration_ticks\":" + duration
                + ",\"client_entity\":\"" + clientEntity + "\"}";
    }
}
