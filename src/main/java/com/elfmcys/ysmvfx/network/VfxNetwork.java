package com.elfmcys.ysmvfx.network;

import com.elfmcys.ysmvfx.YesSteveVfx;
import com.elfmcys.ysmvfx.client.ClientPortalManager;
import com.elfmcys.ysmvfx.model.PortalDefinition;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.network.NetworkEvent;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.PacketDistributor;
import net.minecraftforge.network.simple.SimpleChannel;

import java.util.function.Supplier;

/** Minimal server-to-client protocol for visual effect state. */
public final class VfxNetwork {
    private static final String PROTOCOL = "1";
    private static final SimpleChannel CHANNEL = NetworkRegistry.newSimpleChannel(
            new ResourceLocation(YesSteveVfx.MOD_ID, "main"),
            () -> PROTOCOL,
            PROTOCOL::equals,
            PROTOCOL::equals
    );

    private static int nextMessageId;
    private static boolean initialized;

    private VfxNetwork() {
    }

    public static void init() {
        if (initialized) {
            return;
        }
        initialized = true;
        CHANNEL.registerMessage(nextMessageId++, StartPortalPacket.class,
                StartPortalPacket::encode, StartPortalPacket::decode, StartPortalPacket::handle);
        CHANNEL.registerMessage(nextMessageId++, StopPortalPacket.class,
                StopPortalPacket::encode, StopPortalPacket::decode, StopPortalPacket::handle);
        CHANNEL.registerMessage(nextMessageId++, ClearPortalsPacket.class,
                ClearPortalsPacket::encode, ClearPortalsPacket::decode, ClearPortalsPacket::handle);
    }

    public static void sendStart(ServerPlayer player, PortalDefinition definition) {
        CHANNEL.send(PacketDistributor.PLAYER.with(() -> player), new StartPortalPacket(definition));
    }

    public static void broadcastStart(PortalDefinition definition) {
        CHANNEL.send(PacketDistributor.ALL.noArg(), new StartPortalPacket(definition));
    }

    public static void broadcastStop(String id) {
        CHANNEL.send(PacketDistributor.ALL.noArg(), new StopPortalPacket(id));
    }

    public static void broadcastClear() {
        CHANNEL.send(PacketDistributor.ALL.noArg(), new ClearPortalsPacket());
    }

    public record StartPortalPacket(PortalDefinition definition) {
        public static void encode(StartPortalPacket packet, FriendlyByteBuf buffer) {
            PortalDefinition definition = packet.definition();
            buffer.writeUtf(definition.id(), 64);
            buffer.writeResourceLocation(definition.dimension());
            buffer.writeDouble(definition.x());
            buffer.writeDouble(definition.y());
            buffer.writeDouble(definition.z());
            buffer.writeFloat(definition.radiusX());
            buffer.writeFloat(definition.radiusZ());
            buffer.writeFloat(definition.virtualDepth());
            buffer.writeLong(definition.startGameTime());
            buffer.writeInt(definition.duration());
        }

        public static StartPortalPacket decode(FriendlyByteBuf buffer) {
            return new StartPortalPacket(new PortalDefinition(
                    buffer.readUtf(64),
                    buffer.readResourceLocation(),
                    buffer.readDouble(),
                    buffer.readDouble(),
                    buffer.readDouble(),
                    buffer.readFloat(),
                    buffer.readFloat(),
                    buffer.readFloat(),
                    buffer.readLong(),
                    buffer.readInt()
            ));
        }

        public static void handle(StartPortalPacket packet, Supplier<NetworkEvent.Context> supplier) {
            NetworkEvent.Context context = supplier.get();
            context.enqueueWork(() -> ClientPortalManager.start(packet.definition()));
            context.setPacketHandled(true);
        }
    }

    public record StopPortalPacket(String id) {
        public static void encode(StopPortalPacket packet, FriendlyByteBuf buffer) {
            buffer.writeUtf(packet.id(), 64);
        }

        public static StopPortalPacket decode(FriendlyByteBuf buffer) {
            return new StopPortalPacket(buffer.readUtf(64));
        }

        public static void handle(StopPortalPacket packet, Supplier<NetworkEvent.Context> supplier) {
            NetworkEvent.Context context = supplier.get();
            context.enqueueWork(() -> ClientPortalManager.stop(packet.id()));
            context.setPacketHandled(true);
        }
    }

    public record ClearPortalsPacket() {
        public static void encode(ClearPortalsPacket packet, FriendlyByteBuf buffer) {
        }

        public static ClearPortalsPacket decode(FriendlyByteBuf buffer) {
            return new ClearPortalsPacket();
        }

        public static void handle(ClearPortalsPacket packet, Supplier<NetworkEvent.Context> supplier) {
            NetworkEvent.Context context = supplier.get();
            context.enqueueWork(ClientPortalManager::clear);
            context.setPacketHandled(true);
        }
    }
}
