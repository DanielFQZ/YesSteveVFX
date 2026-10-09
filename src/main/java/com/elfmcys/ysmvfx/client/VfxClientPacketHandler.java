package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.audio.AudioRuntime;
import com.elfmcys.ysmvfx.network.VfxHitSoundPacket;
import net.minecraft.client.Minecraft;
import net.minecraft.network.Connection;
import java.util.LinkedHashMap;
import java.util.Map;

/** Client-only packet application kept out of the dedicated-server class path. */
public final class VfxClientPacketHandler {
    private static final Map<Long, Boolean> SEEN = new LinkedHashMap<>() {
        @Override protected boolean removeEldestEntry(Map.Entry<Long, Boolean> eldest) {
            return size() > 1024;
        }
    };
    private VfxClientPacketHandler() { }

    public static void clear() { SEEN.clear(); }

    public static void accept(VfxHitSoundPacket packet, Connection connection) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.level == null || minecraft.player == null) return;
        if (minecraft.getConnection() == null || minecraft.getConnection().getConnection() != connection) return;
        if (!minecraft.level.dimension().location().toString().equals(packet.dimension())) return;
        if (!Double.isFinite(packet.x()) || !Double.isFinite(packet.y()) || !Double.isFinite(packet.z())
                || packet.segmentIndex() < 0 || packet.segmentIndex() > 65535) return;
        if (SEEN.putIfAbsent(packet.sequence(), Boolean.TRUE) != null) return;
        var position = new net.minecraft.world.phys.Vec3(packet.x(), packet.y(), packet.z());
        var watches = VfxClientRuntime.consumeHit(packet.attacker(), packet.sequence());
        var target = VfxClientRuntime.findEntity(minecraft.level, packet.target());
        if (watches.isEmpty()) {
            AudioRuntime.acceptHit(packet.attacker(), packet.target(), packet.modelId(), packet.animation(),
                    packet.segmentIndex(), position, packet.sequence());
            return;
        }
        for (var watch : watches.values()) {
            if (!watch.sound().isEmpty()) AudioRuntime.playHitSound(packet.attacker(), watch.sound(), position, target, packet.sequence());
            if (!watch.effect().isEmpty())
                VfxClientRuntime.playHitEffect(packet.attacker(), watch.effect(), watch.effectSlot(),
                        VfxClientRuntime.hitOverlayPosition(position, target), packet.sequence());
        }
    }
}
