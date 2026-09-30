package com.elfmcys.ysmvfx.network;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.network.NetworkEvent;

import java.util.UUID;
import java.util.function.Supplier;

/** Server-confirmed hit selector; clients resolve the selector against local audio.json. */
public record VfxHitSoundPacket(long sequence, UUID attacker, UUID target, String dimension,
                                String modelId, String animation, int segmentIndex,
                                double x, double y, double z) {
    public static void encode(VfxHitSoundPacket packet, FriendlyByteBuf buffer) {
        buffer.writeLong(packet.sequence);
        buffer.writeUUID(packet.attacker);
        buffer.writeUUID(packet.target);
        buffer.writeUtf(packet.dimension, 256);
        buffer.writeUtf(packet.modelId, 512);
        buffer.writeUtf(packet.animation, 512);
        buffer.writeVarInt(packet.segmentIndex);
        buffer.writeDouble(packet.x);
        buffer.writeDouble(packet.y);
        buffer.writeDouble(packet.z);
    }

    public static VfxHitSoundPacket decode(FriendlyByteBuf buffer) {
        return new VfxHitSoundPacket(buffer.readLong(), buffer.readUUID(), buffer.readUUID(),
                buffer.readUtf(256), buffer.readUtf(512), buffer.readUtf(512), buffer.readVarInt(),
                buffer.readDouble(), buffer.readDouble(), buffer.readDouble());
    }

    public static void handle(VfxHitSoundPacket packet, Supplier<NetworkEvent.Context> context) {
        NetworkEvent.Context ctx = context.get();
        // consumerMainThread already marshals this callback to the client thread.
        DistExecutor.unsafeRunWhenOn(Dist.CLIENT,
                () -> () -> com.elfmcys.ysmvfx.client.VfxClientPacketHandler.accept(packet, ctx.getNetworkManager()));
        ctx.setPacketHandled(true);
    }
}
