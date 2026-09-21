package com.elfmcys.ysmvfx.command;

import com.elfmcys.ysmvfx.model.PortalDefinition;
import com.elfmcys.ysmvfx.server.ServerPortalManager;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;

/** Commands are deliberately small so another mod can invoke them safely. */
public final class VfxCommands {
    private VfxCommands() {
    }

    @SubscribeEvent
    public static void register(RegisterCommandsEvent event) {
        LiteralArgumentBuilder<CommandSourceStack> root = Commands.literal("vfx")
                .requires(source -> source.hasPermission(2));

        var depth = Commands.argument("depth", DoubleArgumentType.doubleArg(0.0))
                .executes(context -> play(
                        context.getSource(),
                        StringArgumentType.getString(context, "id"),
                        DoubleArgumentType.getDouble(context, "x"),
                        DoubleArgumentType.getDouble(context, "y"),
                        DoubleArgumentType.getDouble(context, "z"),
                        DoubleArgumentType.getDouble(context, "radiusX"),
                        DoubleArgumentType.getDouble(context, "radiusZ"),
                        DoubleArgumentType.getDouble(context, "depth")));
        var radiusZ = Commands.argument("radiusZ", DoubleArgumentType.doubleArg(0.05)).then(depth);
        var radiusX = Commands.argument("radiusX", DoubleArgumentType.doubleArg(0.05)).then(radiusZ);
        var z = Commands.argument("z", DoubleArgumentType.doubleArg()).then(radiusX);
        var y = Commands.argument("y", DoubleArgumentType.doubleArg()).then(z);
        var x = Commands.argument("x", DoubleArgumentType.doubleArg()).then(y);
        var play = Commands.literal("play").then(Commands.argument("id", StringArgumentType.word()).then(x));

        root.then(Commands.literal("portal").then(play));

        root.then(Commands.literal("portal")
                .then(Commands.literal("stop")
                        .then(Commands.argument("id", StringArgumentType.word())
                                .executes(context -> {
                                    String id = StringArgumentType.getString(context, "id");
                                    boolean removed = ServerPortalManager.stop(id);
                                    context.getSource().sendSuccess(
                                            () -> Component.literal(removed
                                                    ? "[ysm_vfx] stopped portal '" + id + "'"
                                                    : "[ysm_vfx] portal not found: '" + id + "'"),
                                            true);
                                    return 1;
                                }))));

        root.then(Commands.literal("portal")
                .then(Commands.literal("clear")
                        .executes(context -> {
                            ServerPortalManager.clear();
                            context.getSource().sendSuccess(
                                    () -> Component.literal("[ysm_vfx] cleared all portals"), true);
                            return 1;
                        })));

        event.getDispatcher().register(root);
    }

    private static int play(CommandSourceStack source, String id, double x, double y, double z,
                            double radiusX, double radiusZ, double depth) {
        PortalDefinition definition = new PortalDefinition(
                id,
                source.getLevel().dimension().location(),
                x, y, z,
                (float) radiusX,
                (float) radiusZ,
                (float) depth,
                source.getLevel().getGameTime(),
                -1
        );
        ServerPortalManager.start(definition);
        source.sendSuccess(() -> Component.literal("[ysm_vfx] started portal '" + id + "'"), true);
        return 1;
    }
}
