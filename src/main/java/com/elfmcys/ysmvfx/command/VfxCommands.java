package com.elfmcys.ysmvfx.command;

import com.elfmcys.ysmvfx.model.PortalDefinition;
import com.elfmcys.ysmvfx.server.ServerPortalManager;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.coordinates.Vec3Argument;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
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

        /*
         * The common form is intentionally short:
         *   /vfx portal play <id> <radiusX> <radiusZ> <depth> [<x> <y> <z>]
         *
         * Vec3Argument also accepts relative coordinates such as ~ ~ ~. When
         * the optional position is omitted, the portal is placed at the
         * command executor's feet, which is the useful case for testing.
         */
        var position = Commands.argument("position", Vec3Argument.vec3())
                .executes(context -> play(context, Vec3Argument.getVec3(context, "position")));
        var depth = Commands.argument("depth", DoubleArgumentType.doubleArg(0.0))
                .executes(context -> play(context, null))
                .then(position);
        var radiusZ = Commands.argument("radiusZ", DoubleArgumentType.doubleArg(0.05)).then(depth);
        var radiusX = Commands.argument("radiusX", DoubleArgumentType.doubleArg(0.05)).then(radiusZ);
        var play = Commands.literal("play")
                .then(Commands.argument("id", StringArgumentType.word()).then(radiusX));

        root.then(Commands.literal("portal").then(play));

        var timedPosition = Commands.argument("position", Vec3Argument.vec3())
                .executes(context -> play(context, Vec3Argument.getVec3(context, "position"), true));
        var duration = Commands.argument("durationTicks", IntegerArgumentType.integer(1))
                .executes(context -> play(context, null, true))
                .then(timedPosition);
        var timedDepth = Commands.argument("depth", DoubleArgumentType.doubleArg(0.0)).then(duration);
        var timedRadiusZ = Commands.argument("radiusZ", DoubleArgumentType.doubleArg(0.05)).then(timedDepth);
        var timedRadiusX = Commands.argument("radiusX", DoubleArgumentType.doubleArg(0.05)).then(timedRadiusZ);
        var playFor = Commands.literal("play_for")
                .then(Commands.argument("id", StringArgumentType.word()).then(timedRadiusX));
        root.then(Commands.literal("portal").then(playFor));

        root.then(Commands.literal("portal")
                .then(Commands.literal("stop")
                        .then(Commands.argument("id", StringArgumentType.word())
                                .executes(context -> {
                                    String id = StringArgumentType.getString(context, "id");
                                    boolean removed = ServerPortalManager.stop(id);
                                    context.getSource().sendSuccess(
                                            () -> Component.literal(removed
                                                    ? "[yesstevevfx] stopped portal '" + id + "'"
                                                    : "[yesstevevfx] portal not found: '" + id + "'"),
                                            true);
                                    return 1;
                                }))));

        root.then(Commands.literal("portal")
                .then(Commands.literal("clear")
                        .executes(context -> {
                            ServerPortalManager.clear();
                            context.getSource().sendSuccess(
                                    () -> Component.literal("[yesstevevfx] cleared all portals"), true);
                            return 1;
                        })));

        event.getDispatcher().register(root);
    }

    private static int play(CommandContext<CommandSourceStack> context, Vec3 explicitPosition) {
        return play(context, explicitPosition, false);
    }

    private static int play(CommandContext<CommandSourceStack> context, Vec3 explicitPosition, boolean timed) {
        CommandSourceStack source = context.getSource();
        Vec3 position = explicitPosition != null ? explicitPosition : executorFeet(source);
        String id = StringArgumentType.getString(context, "id");
        double radiusX = DoubleArgumentType.getDouble(context, "radiusX");
        double radiusZ = DoubleArgumentType.getDouble(context, "radiusZ");
        double depth = DoubleArgumentType.getDouble(context, "depth");
        int duration = timed ? IntegerArgumentType.getInteger(context, "durationTicks") : -1;

        PortalDefinition definition = new PortalDefinition(
                id,
                source.getLevel().dimension().location(),
                position.x, position.y, position.z,
                (float) radiusX,
                (float) radiusZ,
                (float) depth,
                source.getLevel().getGameTime(),
                duration
        );
        ServerPortalManager.start(definition);
        source.sendSuccess(() -> Component.literal("[yesstevevfx] started "
                + (timed ? duration + "-tick " : "") + "portal '" + id + "'"), true);
        return 1;
    }

    private static Vec3 executorFeet(CommandSourceStack source) {
        Entity entity = source.getEntity();
        return entity != null ? entity.position() : source.getPosition();
    }
}
