package com.elfmcys.ysmvfx.server;

import com.elfmcys.ysmvfx.model.PortalDefinition;
import com.elfmcys.ysmvfx.network.VfxNetwork;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;

import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Server-side authoritative list used only to replicate visual effects. */
public final class ServerPortalManager {
    private static final Map<String, PortalDefinition> ACTIVE = new ConcurrentHashMap<>();

    private ServerPortalManager() {
    }

    public static void start(PortalDefinition definition) {
        ACTIVE.put(definition.id(), definition);
        VfxNetwork.broadcastStart(definition);
    }

    public static boolean stop(String id) {
        if (ACTIVE.remove(id) != null) {
            VfxNetwork.broadcastStop(id);
            return true;
        }
        return false;
    }

    public static void clear() {
        ACTIVE.clear();
        VfxNetwork.broadcastClear();
    }

    public static Collection<PortalDefinition> active() {
        return ACTIVE.values();
    }

    @SubscribeEvent
    public static void onPlayerLoggedIn(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            for (PortalDefinition definition : ACTIVE.values()) {
                VfxNetwork.sendStart(player, definition);
            }
        }
    }
}
