package com.elfmcys.ysmvfx;

import com.elfmcys.ysmvfx.command.VfxCommands;
import com.elfmcys.ysmvfx.entity.VfxCarrierEntity;
import com.elfmcys.ysmvfx.network.VfxNetwork;
import com.elfmcys.ysmvfx.server.ServerPortalManager;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.fml.common.Mod;

/**
 * Small, visual-only effects framework. Gameplay, teleportation and entity
 * movement intentionally stay outside this mod.
 */
@Mod(YesSteveVfx.MOD_ID)
public final class YesSteveVfx {
    public static final String MOD_ID = "yesstevevfx";

    public YesSteveVfx() {
        VfxCarrierEntity.TYPES.register(FMLJavaModLoadingContext.get().getModEventBus());
        VfxNetwork.init();
        MinecraftForge.EVENT_BUS.register(VfxCommands.class);
        MinecraftForge.EVENT_BUS.register(ServerPortalManager.class);
    }
}
