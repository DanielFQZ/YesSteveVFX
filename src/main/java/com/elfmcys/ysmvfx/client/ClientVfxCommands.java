package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.YesSteveVfx;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.ResourceLocationArgument;
import net.minecraft.network.chat.Component;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

import java.util.UUID;
import com.elfmcys.ysmvfx.audio.AudioRuntime;

/**
 * Small client-only command surface used to exercise local VFX packs.
 *
 * <p>The command always targets the local player. It intentionally does not
 * expose a UUID argument: YSM instruction frames and the public API provide
 * the entity-targeted form used by normal gameplay.</p>
 */
@Mod.EventBusSubscriber(modid = YesSteveVfx.MOD_ID, value = Dist.CLIENT,
        bus = Mod.EventBusSubscriber.Bus.FORGE)
public final class ClientVfxCommands {
    private ClientVfxCommands() {
    }

    @SubscribeEvent
    public static void register(RegisterClientCommandsEvent event) {
        var root = Commands.literal("vfx_client")
                .then(Commands.literal("reload")
                        .executes(context -> reload(context.getSource())))
                .then(Commands.literal("play")
                        .then(Commands.argument("effect", ResourceLocationArgument.id())
                                .suggests((context, builder) -> {
                                    VfxClientRuntime.bundles().keySet().forEach(builder::suggest);
                                    return builder.buildFuture();
                                })
                                .then(Commands.argument("slot", StringArgumentType.word())
                                        .executes(context -> play(
                                                context.getSource(),
                                                ResourceLocationArgument.getId(context, "effect").toString(),
                                                StringArgumentType.getString(context, "slot"))))))
                .then(Commands.literal("stop")
                        .then(Commands.argument("slot", StringArgumentType.word())
                                .executes(context -> stop(
                                        context.getSource(),
                                        StringArgumentType.getString(context, "slot")))))
                .then(Commands.literal("set")
                        .then(Commands.argument("slot", StringArgumentType.word())
                                .then(Commands.argument("name", StringArgumentType.word())
                                        .then(Commands.argument("value", DoubleArgumentType.doubleArg())
                                                .executes(context -> set(
                                                        context.getSource(),
                                                        StringArgumentType.getString(context, "slot"),
                                                        StringArgumentType.getString(context, "name"),
                                                        DoubleArgumentType.getDouble(context, "value")))))));

        root.then(Commands.literal("sound")
                .then(Commands.literal("play").then(Commands.argument("sound", ResourceLocationArgument.id())
                        .suggests((ctx, builder) -> { AudioRuntime.catalog().sounds().keySet().forEach(builder::suggest); return builder.buildFuture(); })
                        .then(Commands.argument("slot", StringArgumentType.word()).executes(ctx -> {
                            boolean ok=AudioRuntime.play(localPlayerId(), ResourceLocationArgument.getId(ctx,"sound").toString(),StringArgumentType.getString(ctx,"slot"));
                            if(!ok) return fail(ctx.getSource(),"[yesstevevfx] Sound unavailable, reload in progress, or invalid slot");
                            ctx.getSource().sendSuccess(()->Component.literal("[yesstevevfx] Sound queued"),false); return 1;
                        }))))
                .then(Commands.literal("stop").then(Commands.argument("slot",StringArgumentType.word()).executes(ctx ->
                        AudioRuntime.stop(localPlayerId(),StringArgumentType.getString(ctx,"slot"))?1:0))));
        event.getDispatcher().register(root);
    }

    private static int reload(CommandSourceStack source) {
        if(VfxClientRuntime.isReloading()) return fail(source,"[yesstevevfx] Reload already in progress");
        source.sendSuccess(()->Component.literal("[yesstevevfx] Loading effects and sounds..."),false);
        VfxClientRuntime.reloadLocal().thenAccept(ok -> {
            if(ok) source.sendSuccess(()->Component.literal("[yesstevevfx] Loaded " + VfxClientRuntime.bundles().size()
                    + " effects / " + AudioRuntime.catalog().sounds().size() + " sounds / " + AudioRuntime.catalog().hits().size()
                    + " hit bindings"),false);
            else source.sendFailure(Component.literal("[yesstevevfx] Reload failed; see latest.log. Previous configuration retained."));
        });
        return 1;
    }

    private static int play(CommandSourceStack source, String effectId, String slot) {
        UUID playerId = localPlayerId();
        if (playerId == null) {
            return fail(source, "[yesstevevfx] no local player is available");
        }
        boolean started = VfxClientRuntime.play(playerId, effectId, slot);
        source.sendSuccess(() -> Component.literal(started
                ? "[yesstevevfx] started '" + effectId + "' in slot '" + slot + "'"
                : "[yesstevevfx] could not start '" + effectId + "' in slot '" + slot + "'"), false);
        return started ? 1 : 0;
    }

    private static int stop(CommandSourceStack source, String slot) {
        UUID playerId = localPlayerId();
        if (playerId == null) {
            return fail(source, "[yesstevevfx] no local player is available");
        }
        boolean stopped = VfxClientRuntime.stop(playerId, slot);
        source.sendSuccess(() -> Component.literal(stopped
                ? "[yesstevevfx] stopped slot '" + slot + "'"
                : "[yesstevevfx] no running effect in slot '" + slot + "'"), false);
        return stopped ? 1 : 0;
    }

    private static int set(CommandSourceStack source, String slot, String name, double value) {
        UUID playerId = localPlayerId();
        if (playerId == null) {
            return fail(source, "[yesstevevfx] no local player is available");
        }
        boolean updated = VfxClientRuntime.set(playerId, slot, name, value);
        source.sendSuccess(() -> Component.literal(updated
                ? "[yesstevevfx] set " + name + " = " + value + " in slot '" + slot + "'"
                : "[yesstevevfx] no running effect in slot '" + slot + "'"), false);
        return updated ? 1 : 0;
    }

    private static UUID localPlayerId() {
        Minecraft minecraft = Minecraft.getInstance();
        return minecraft.player == null ? null : minecraft.player.getUUID();
    }

    private static int fail(CommandSourceStack source, String message) {
        source.sendFailure(Component.literal(message));
        return 0;
    }
}
