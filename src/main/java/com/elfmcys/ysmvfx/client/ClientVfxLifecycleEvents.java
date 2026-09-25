package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.YesSteveVfx;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/** Loads local assets once per client world and advances carrier effects. */
@Mod.EventBusSubscriber(modid = YesSteveVfx.MOD_ID, value = Dist.CLIENT,
        bus = Mod.EventBusSubscriber.Bus.FORGE)
public final class ClientVfxLifecycleEvents {
    private static ClientLevel lastLevel;

    private ClientVfxLifecycleEvents() {
    }

    @SubscribeEvent
    public static void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) {
            return;
        }
        net.minecraft.client.Minecraft minecraft = net.minecraft.client.Minecraft.getInstance();
        ClientLevel level = minecraft.level;
        if (level == null) {
            if (lastLevel != null || VfxClientRuntime.isLoaded()) {
                VfxClientRuntime.unload();
            }
            lastLevel = null;
            return;
        }
        if (lastLevel != level) {
            VfxClientRuntime.unload();
            // One automatic attempt per world. Failed files are retried explicitly
            // by the reload command, rather than parsed and logged twenty times a second.
            VfxClientRuntime.reloadLocal();
        }
        lastLevel = level;
        VfxClientRuntime.tick(level);
    }
}
