package com.elfmcys.ysmvfx.audio;

import com.elfmcys.ysmvfx.asset.*;
import java.io.IOException;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class AudioTest {
    @TempDir Path temp;
    private static final Path DEMO = Path.of("examples/vfx_audio_demo");
    private static final String FILE = "assets/yesstevevfx/sounds/挥刀.ogg";
    private AudioCatalog parse(String json) throws Exception {
        return AudioCatalog.parse(new VfxAssetCatalog(Map.of(), Map.of("test", new PackAssets(Map.of(
                "audio.json", json.getBytes(StandardCharsets.UTF_8), FILE, Files.readAllBytes(DEMO.resolve(FILE)))))));
    }
    @Test void audioOnlyPackLoadsAndDecodesChineseFilename() throws Exception {
        var catalog = new LocalVfxAssetSource(Path.of("examples")).loadCatalog();
        var audio = AudioCatalog.parse(catalog);
        var sound = audio.sounds().get("yesstevevfx:vfx_audio_demo/slash");
        assertNotNull(sound);
        assertTrue(sound.follow());
        long pcm = OggValidation.validate(sound.assets().read(sound.file()));
        assertTrue(pcm > 38000 && pcm < 41000, "0.45 seconds mono PCM");
    }
    @Test void unifiedRootSoundsAreNormalizedBeforeParsing() throws Exception {
        Path packs = temp.resolve("packs");
        Path root = packs.resolve("root_audio");
        Files.createDirectories(root.resolve("sounds"));
        Files.writeString(root.resolve("manifest.json"),
                "{\"format_version\":1,\"pack_id\":\"root_audio\",\"display_name\":\"Root\",\"effects\":[]}");
        String audio = Files.readString(DEMO.resolve("audio.json"))
                .replace("assets/yesstevevfx/sounds/挥刀.ogg", "sounds/挥刀.ogg");
        Files.writeString(root.resolve("audio.json"), audio);
        Files.copy(DEMO.resolve(FILE), root.resolve("sounds/挥刀.ogg"));
        var catalog = AudioCatalog.parse(new LocalVfxAssetSource(packs).loadCatalog());
        assertNotNull(catalog.sounds().get("yesstevevfx:vfx_audio_demo/slash"));
    }
    @Test void rejectsBadMetadataAndUnknownFields() throws Exception {
        String good = Files.readString(DEMO.resolve("audio.json"));
        assertEquals(1, parse(good).sounds().size());
        for (String invalid : List.of(
                good.replace("\"volume\": 1", "\"volume\": 2"),
                good.replace("\"follow\": true", "\"follow\": \"true\""),
                good.replace("\"range\": 24", "\"range\": null"),
                good.replace("\"pitch\": 1", "\"pitch\": 0"),
                good.replace("\"volume\"", "\"volum\""),
                good.replace(FILE, "assets/yesstevevfx/sounds/../other.ogg"),
                good.replace("yesstevevfx:vfx_audio_demo/slash", "yesstevevfx:../slash"))) {
            assertThrows(IOException.class, () -> parse(invalid), invalid);
        }
    }
    @Test void rejectsDuplicateSoundIdsAcrossPacksAndMissingHitSound() throws Exception {
        var assets = new PackAssets(Map.of("audio.json", Files.readAllBytes(DEMO.resolve("audio.json")), FILE, Files.readAllBytes(DEMO.resolve(FILE))));
        assertThrows(IOException.class, () -> AudioCatalog.parse(new VfxAssetCatalog(Map.of(), Map.of("a", assets, "b", assets))));
        String hit = Files.readString(DEMO.resolve("audio.json")).replace("\"hit_bindings\": []", "\"hit_bindings\": [{\"model_id\":\"角色\",\"animation\":\"attack\",\"segment_index\":0,\"sound\":\"missing\"}]");
        assertThrows(IOException.class, () -> parse(hit));
    }
    @Test void corruptStereoAndOverlongOggAreRejected() throws Exception {
        byte[] good = Files.readAllBytes(DEMO.resolve(FILE));
        assertThrows(IOException.class, () -> OggValidation.validate(Arrays.copyOf(good, good.length-5)));
        good[good.length-1] ^= 1;
        assertThrows(IOException.class, () -> OggValidation.validate(good));
        for (String name : List.of("stereo.ogg", "too-long.ogg")) {
            byte[] bytes = Files.readAllBytes(Path.of("src/test/resources/audio", name));
            assertThrows(IOException.class, () -> OggValidation.validate(bytes), name);
        }
    }
    @Test void queuePreservesOrderAndRejectsOldSessionsAndFloods() {
        var queue = new AudioActionQueue(); var owner = UUID.randomUUID(); long session = queue.session();
        assertTrue(queue.offer(owner,"swing","first",session));
        assertTrue(queue.offer(owner,"swing",null,session));
        var actions = queue.drain(); assertEquals("first", actions.get(0).sound()); assertNull(actions.get(1).sound());
        queue.invalidate(); assertFalse(queue.offer(owner,"swing","stale",session));
        assertFalse(queue.offer(owner,"bad slot","first",queue.session()));
        for (int i=0;i<256;i++) assertTrue(queue.offer(owner,"swing","first",queue.session()));
        assertFalse(queue.offer(owner,"swing","overflow",queue.session()));
        queue.invalidate(); assertTrue(queue.drain().isEmpty());
    }
}
