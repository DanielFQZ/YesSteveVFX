package com.elfmcys.ysmvfx.network;

import com.elfmcys.ysmvfx.YesSteveVfx;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.PacketDistributor;
import net.minecraftforge.network.NetworkDirection;
import net.minecraftforge.network.simple.SimpleChannel;

import java.util.concurrent.atomic.AtomicLong;

/** Optional VFX packets. The server only forwards validated selectors; assets stay client-side. */
public final class VfxNetwork {
    private static final String VERSION = "1";
    private static final AtomicLong HIT_SEQUENCE = new AtomicLong();
    private static final SimpleChannel CHANNEL = NetworkRegistry.newSimpleChannel(
            new ResourceLocation(YesSteveVfx.MOD_ID, "main"), () -> VERSION,
            VfxNetwork::acceptVersion, VfxNetwork::acceptVersion);

    private VfxNetwork() { }

    public static void init() {
        CHANNEL.messageBuilder(VfxHitSoundPacket.class, 0, NetworkDirection.PLAY_TO_CLIENT)
                .encoder(VfxHitSoundPacket::encode)
                .decoder(VfxHitSoundPacket::decode)
                .consumerMainThread(VfxHitSoundPacket::handle)
                .add();
    }

    private static boolean acceptVersion(String version) {
        return VERSION.equals(version) || NetworkRegistry.ABSENT.equals(version)
                || NetworkRegistry.ACCEPTVANILLA.equals(version);
    }

    public static void sendHit(ServerLevel level, ServerPlayer attacker,
                               String modelId, String animation, int segmentIndex, Vec3 position,
                               java.util.UUID targetId) {
        if (modelId == null || modelId.isBlank() || modelId.length() > 512
                || animation == null || animation.isBlank() || animation.length() > 512
                || segmentIndex < 0 || segmentIndex > 65535 || position == null
                || !Double.isFinite(position.x) || !Double.isFinite(position.y) || !Double.isFinite(position.z)) return;
        long sequence = HIT_SEQUENCE.incrementAndGet();
        var packet = new VfxHitSoundPacket(sequence, attacker.getUUID(), targetId,
                level.dimension().location().toString(), modelId, animation, segmentIndex,
                position.x, position.y, position.z);
        for (ServerPlayer player : level.players()) {
            if (player.distanceToSqr(position) <= 64.0D * 64.0D
                    && CHANNEL.isRemotePresent(player.connection.connection)) {
                CHANNEL.send(PacketDistributor.PLAYER.with(() -> player), packet);
            }
        }
    }
}
