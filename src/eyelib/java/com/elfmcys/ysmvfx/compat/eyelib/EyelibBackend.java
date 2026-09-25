package com.elfmcys.ysmvfx.compat.eyelib;

import com.elfmcys.ysmvfx.asset.EffectAssetBundle;
import com.elfmcys.ysmvfx.client.CarrierFactory;
import com.elfmcys.ysmvfx.client.EffectBackend;
import com.elfmcys.ysmvfx.client.EffectHandle;
import com.elfmcys.ysmvfx.client.EffectPlayRequest;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.serialization.JsonOps;
import io.github.tt432.eyelib.animation.AnimationComponent;
import io.github.tt432.eyelib.animation.AnimationRegistries;
import io.github.tt432.eyelib.animation.bedrock.BrAnimation;
import io.github.tt432.eyelib.animation.bedrock.controller.BrAnimationControllers;
import io.github.tt432.eyelib.bridge.client.render.texture.NativeImagePort;
import io.github.tt432.eyelib.bridge.particle.ParticlePort;
import io.github.tt432.eyelib.capability.RenderData;
import io.github.tt432.eyelib.client.manager.ClientEntityManager;
import io.github.tt432.eyelib.client.manager.ModelManager;
import io.github.tt432.eyelib.client.manager.RenderControllerManager;
import io.github.tt432.eyelib.client.render.EntityRenderOrchestrator;
import io.github.tt432.eyelib.client.render.controller.RenderControllers;
import io.github.tt432.eyelib.client.registry.AnimationAssetRegistry;
import io.github.tt432.eyelib.importer.animation.bedrock.BrAnimationSet;
import io.github.tt432.eyelib.importer.animation.bedrock.controller.BrAnimationControllerSet;
import io.github.tt432.eyelib.importer.entity.BrClientEntity;
import io.github.tt432.eyelib.importer.model.importer.BedrockGeometryImporter;
import io.github.tt432.eyelib.importer.particle.BrParticle;
import io.github.tt432.eyelib.model.Model;
import io.github.tt432.eyelib.particle.loading.ParticleDefinitionRegistry;
import io.github.tt432.eyelib.particle.runtime.ParticleDefinition;
import io.github.tt432.eyelib.particle.runtime.ParticleDefinitionAdapter;
import io.github.tt432.eyelib.util.repository.Repository;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.LivingEntity;
import org.jetbrains.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Direct eyelib integration.  This source set is deliberately optional: the normal
 * VFX build does not mention eyelib, while a distribution that includes eyelib adds
 * this directory to the client compile source set.
 *
 * <p>The backend owns only resources whose identifiers are in the {@code yesstevevfx}
 * namespace.  It therefore never calls a global {@code replaceAll} on a registry
 * containing another mod's assets.</p>
 */
public final class EyelibBackend implements EffectBackend {
    private static final Logger LOGGER = LoggerFactory.getLogger(EyelibBackend.class);
    private static final String NAMESPACE = "yesstevevfx";

    private final Map<EffectHandle, Instance> instances = new LinkedHashMap<>();
    private final Set<String> ownedModelIds = new HashSet<>();
    private final Set<String> ownedEntityIds = new HashSet<>();
    private final Set<String> ownedRenderControllerIds = new HashSet<>();
    private final Set<String> ownedAnimationIds = new HashSet<>();
    private final Set<String> ownedControllerIds = new HashSet<>();
    private final Set<String> ownedParticleIds = new HashSet<>();
    private final Set<String> ownedTextureIds = new HashSet<>();
    private Map<String, EffectAssetBundle> loadedBundles = Map.of();

    @Override
    public void reload(Map<String, EffectAssetBundle> bundles) throws Exception {
        Objects.requireNonNull(bundles, "bundles");
        Publication publication = parse(bundles);

        // Publish only after every JSON file in every bundle has parsed successfully.
        clear();
        removeOwnedResources();
        ModelManager.INSTANCE.putAll(publication.models);
        ClientEntityManager.INSTANCE.putAll(publication.entities);
        RenderControllerManager.INSTANCE.putAll(publication.renderControllers);
        // 21.1.14 has one global staging slot. Publishing individual entries
        // preserves eyelib's loaded assets and other mods' animation sources.
        publication.animations.values().forEach(AnimationAssetRegistry::publishAnimation);
        publication.controllers.values().forEach(AnimationAssetRegistry::publishAnimationController);
        publication.particles.values().forEach(ParticleDefinitionRegistry.publisher()::publishParticle);
        publication.textures.forEach((id, bytes) -> {
            try {
                NativeImagePort.loadAndUpload(id, new ByteArrayInputStream(bytes));
            } catch (Exception e) {
                throw new PublicationException("Cannot upload texture " + id, e);
            }
        });

        ownedModelIds.addAll(publication.models.keySet());
        ownedEntityIds.addAll(publication.entities.keySet());
        ownedRenderControllerIds.addAll(publication.renderControllers.keySet());
        publication.animations.values().forEach(value -> ownedAnimationIds.addAll(value.animations().keySet()));
        publication.controllers.values().forEach(value -> ownedControllerIds.addAll(value.animationControllers().keySet()));
        ownedParticleIds.addAll(publication.particles.keySet());
        ownedTextureIds.addAll(publication.textures.keySet());
        loadedBundles = Map.copyOf(bundles);
    }

    @Override
    public @Nullable EffectHandle play(EffectPlayRequest request, EffectAssetBundle bundle,
                                       CarrierFactory carrierFactory, ClientLevel level) throws Exception {
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(bundle, "bundle");
        Objects.requireNonNull(carrierFactory, "carrierFactory");
        Objects.requireNonNull(level, "level");
        if (!loadedBundles.containsKey(bundle.definition().id())) {
            throw new IllegalStateException("Effect bundle has not been reloaded: " + bundle.definition().id());
        }

        LivingEntity carrier = carrierFactory.create(level, request);
        if (carrier == null) {
            return null;
        }
        carrier.moveTo(request.position().x, request.position().y, request.position().z,
                request.yaw(), request.pitch());
        try {
            RenderData<?> data = RenderData.getComponent(carrier);
            data.ensureOwner(carrier);
            BrClientEntity clientEntity = parseClientEntity(bundle);
            EntityRenderOrchestrator.setupClientEntity(clientEntity, data).forEach(Runnable::run);
        } catch (Exception | LinkageError exception) {
            carrierFactory.remove(carrier);
            throw exception;
        }

        Instance instance = new Instance(carrier, carrierFactory, bundle, request.clientTick());
        instances.put(instance, instance);
        return instance;
    }

    @Override
    public boolean stop(EffectHandle handle) {
        Instance instance = instances.remove(handle);
        if (instance == null) {
            return false;
        }
        trackParticles(instance);
        instance.particleIds.forEach(ParticlePort.getSpawnAdapter()::remove);
        instance.factory.remove(instance.carrier);
        return true;
    }

    @Override
    public boolean set(EffectHandle handle, String name, double value) {
        if (name == null || name.isBlank() || !Double.isFinite(value)) {
            return false;
        }
        Instance instance = instances.get(handle);
        if (instance == null) {
            return false;
        }
        RenderData<?> data = RenderData.getComponent(instance.carrier);
        data.ensureOwner(instance.carrier);
        data.requireScope().set(name.indexOf('.') >= 0 ? name : "variable." + name, value);
        return true;
    }

    @Override
    public void update(EffectHandle handle, EffectPlayRequest request) {
        Instance instance = instances.get(handle);
        if (instance == null || request == null) {
            return;
        }
        /*
         * Keep the carrier's previous transform intact.  moveTo() is intended
         * for teleports/spawns and also resets xo/yo/zo and the old rotations.
         * Calling it once per client tick makes both Minecraft's entity renderer
         * and eyelib's locator resolver see no interval to interpolate, so a
         * following effect advances in visible 20 Hz steps.  setPos and the
         * current rotation setters only update the current transform; the
         * renderer can then interpolate from the previous tick exactly like
         * the source entity.  LivingEntity's
         * body/head rotations are updated as well because eyelib's locator
         * resolver interpolates those fields for attached particles.
         */
        instance.carrier.setPos(request.position().x, request.position().y, request.position().z);
        instance.carrier.setYRot(request.yaw());
        instance.carrier.setXRot(request.pitch());
        instance.carrier.setYBodyRot(request.yaw());
        instance.carrier.setYHeadRot(request.yaw());
    }

    @Override
    public void clear() {
        for (Instance instance : List.copyOf(instances.values())) {
            stop(instance);
        }
    }

    @Override
    public void unload() {
        clear();
        removeOwnedResources();
        loadedBundles = Map.of();
    }

    @Override
    public void tick(ClientLevel level) {
        long now = level.getGameTime();
        for (Instance instance : List.copyOf(instances.values())) {
            if (instance.carrier.level() != level || !instance.carrier.isAlive()
                    || now - instance.startTick >= instance.bundle.definition().durationTicks()) {
                stop(instance);
            }
        }
    }

    /** Capture public animation output each rendered frame, including completed clips. */
    public void afterRenderFrame() {
        instances.values().forEach(EyelibBackend::trackParticles);
    }

    private static void trackParticles(Instance instance) {
        RenderData<?> data = RenderData.getComponent(instance.carrier);
        AnimationComponent animation = data.getAnimationComponent();
        if (animation.effects != null) {
            animation.effects.particles.forEach(particles -> particles.forEach(
                    particle -> instance.particleIds.add(particle.particleUUID())));
        }
    }

    private void removeOwnedResources() {
        removeOwned(ModelManager.INSTANCE, ownedModelIds);
        removeOwned(ClientEntityManager.INSTANCE, ownedEntityIds);
        removeOwned(RenderControllerManager.INSTANCE, ownedRenderControllerIds);
        removeOwned(AnimationRegistries.animation(), ownedAnimationIds);
        removeOwned(AnimationRegistries.animation(), ownedControllerIds);
        removeOwned(ParticleDefinitionRegistry.store(), ownedParticleIds);
        ownedTextureIds.forEach(id -> Minecraft.getInstance().getTextureManager().release(
                ResourceLocation.tryParse(id)));
        ownedModelIds.clear();
        ownedEntityIds.clear();
        ownedRenderControllerIds.clear();
        ownedAnimationIds.clear();
        ownedControllerIds.clear();
        ownedParticleIds.clear();
        ownedTextureIds.clear();
    }

    private static <T> void removeOwned(Repository<T> registry, Set<String> owned) {
        if (owned.isEmpty()) return;
        Map<String, T> remaining = new LinkedHashMap<>(registry.all());
        owned.forEach(remaining::remove);
        registry.replaceAll(remaining);
    }

    private Publication parse(Map<String, EffectAssetBundle> bundles) throws Exception {
        Publication result = new Publication();
        for (EffectAssetBundle bundle : bundles.values()) {
            BrClientEntity entity = parseClientEntity(bundle);
            result.entities.put(entity.identifier(), entity);

            for (Map.Entry<String, byte[]> file : bundle.files().entrySet()) {
                String path = file.getKey();
                JsonElement json;
                if (path.startsWith("assets/eyelib/models/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    validateBedrockTextureBounds(json, path);
                    Map<String, Model> models = BedrockGeometryImporter.importJson(json.getAsJsonObject());
                    result.models.putAll(models);
                    requireNamespace(models.keySet(), "geometry");
                } else if (path.startsWith("assets/eyelib/animations/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    BrAnimationSet set = BrAnimationSet.CODEC.parse(JsonOps.INSTANCE, json).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid animation: " + path));
                    BrAnimation animation = BrAnimation.fromSchemaSet(set);
                    result.animations.put(path, animation);
                    requireNamespace(animation.animations().keySet(), "animation");
                } else if (path.startsWith("assets/eyelib/animation_controllers/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    BrAnimationControllerSet set = BrAnimationControllerSet.CODEC.parse(JsonOps.INSTANCE, json).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid animation controller: " + path));
                    BrAnimationControllers controllers = BrAnimationControllers.fromSchemaSet(set);
                    result.controllers.put(path, controllers);
                    requireNamespace(controllers.animationControllers().keySet(), "controller.animation");
                } else if (path.startsWith("assets/eyelib/render_controllers/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    RenderControllers controllers = RenderControllers.CODEC.parse(JsonOps.INSTANCE, json).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid render controller: " + path));
                    result.renderControllers.putAll(controllers.render_controllers());
                    requireNamespace(controllers.render_controllers().keySet(), "controller.render");
                } else if (path.startsWith("assets/eyelib/particles/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    BrParticle particle = BrParticle.CODEC.parse(JsonOps.INSTANCE, json).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid particle: " + path));
                    if (!particle.particleEffect().description().identifier().startsWith(NAMESPACE + ":")) {
                        throw new IllegalArgumentException("Particle identifier must use " + NAMESPACE + ": " + path);
                    }
                    ParticleDefinition definition = ParticleDefinitionAdapter.fromSchema(particle).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid particle components: " + path));
                    result.particles.put(definition.identifier(), definition);
                } else if (path.startsWith("assets/eyelib/textures/") && path.endsWith(".png")) {
                    // Bedrock entity textures normally omit .png, while the
                    // eyelib particle renderer appends .png before asking
                    // TextureManager for the image. Publish both spellings so
                    // one uploaded asset works for model and particle paths.
                    String relative = path.substring("assets/eyelib/".length(), path.length() - ".png".length());
                    byte[] bytes = file.getValue().clone();
                    result.textures.put(NAMESPACE + ":" + relative, bytes.clone());
                    result.textures.put(NAMESPACE + ":" + relative + ".png", bytes);
                } else if (path.startsWith("assets/eyelib/particles/") && path.endsWith(".png")) {
                    // Older editor exports placed particle sprite PNGs beside
                    // the particle JSON. Keep those packs loadable while the
                    // editor writes new images to assets/eyelib/textures/.
                    String relative = path.substring("assets/eyelib/particles/".length(), path.length() - ".png".length());
                    byte[] bytes = file.getValue().clone();
                    result.textures.put(NAMESPACE + ":particles/" + relative, bytes.clone());
                    result.textures.put(NAMESPACE + ":particles/" + relative + ".png", bytes.clone());
                    result.textures.put(NAMESPACE + ":textures/" + relative, bytes.clone());
                    result.textures.put(NAMESPACE + ":textures/" + relative + ".png", bytes);
                }
            }
        }
        return result;
    }

    /**
     * eyelib's model baker samples the texture while classifying cube faces. A
     * malformed Bedrock box-UV can otherwise reach NativeImage with an out of
     * range coordinate and crash the render thread. Reject it during reload,
     * where the command can report a bad asset and keep the client alive.
     */
    private static void validateBedrockTextureBounds(JsonElement root, String path) {
        if (!root.isJsonObject()) return;
        JsonElement geometries = root.getAsJsonObject().get("minecraft:geometry");
        if (geometries == null || !geometries.isJsonArray()) return;
        for (JsonElement geometry : geometries.getAsJsonArray()) {
            if (!geometry.isJsonObject()) continue;
            JsonObject object = geometry.getAsJsonObject();
            JsonObject description = object.getAsJsonObject("description");
            if (description == null) continue;
            int textureWidth = positiveInt(description, "texture_width", path);
            int textureHeight = positiveInt(description, "texture_height", path);
            JsonElement bones = object.get("bones");
            if (bones != null && bones.isJsonArray()) {
                for (JsonElement bone : bones.getAsJsonArray()) {
                    validateBoneTextureBounds(bone, textureWidth, textureHeight, path);
                }
            }
        }
    }

    private static void validateBoneTextureBounds(JsonElement bone, int textureWidth, int textureHeight, String path) {
        if (!bone.isJsonObject()) return;
        JsonObject object = bone.getAsJsonObject();
        JsonElement cubes = object.get("cubes");
        if (cubes != null && cubes.isJsonArray()) {
            for (JsonElement cube : cubes.getAsJsonArray()) {
                if (!cube.isJsonObject()) continue;
                JsonObject c = cube.getAsJsonObject();
                JsonElement uv = c.get("uv");
                JsonElement size = c.get("size");
                if (uv != null && uv.isJsonArray() && size != null && size.isJsonArray()
                        && uv.getAsJsonArray().size() >= 2 && size.getAsJsonArray().size() >= 3) {
                    double u = number(uv.getAsJsonArray().get(0), path);
                    double v = number(uv.getAsJsonArray().get(1), path);
                    double x = Math.abs(number(size.getAsJsonArray().get(0), path));
                    double y = Math.abs(number(size.getAsJsonArray().get(1), path));
                    double z = Math.abs(number(size.getAsJsonArray().get(2), path));
                    double requiredWidth = u + 2.0 * (x + z);
                    double requiredHeight = v + y + z;
                    if (u < 0 || v < 0 || requiredWidth > textureWidth || requiredHeight > textureHeight) {
                        throw new IllegalArgumentException("Bedrock box UV exceeds texture bounds in " + path
                                + " (required at least " + Math.ceil(requiredWidth) + "x"
                                + Math.ceil(requiredHeight) + ", declared " + textureWidth + "x" + textureHeight + ")");
                    }
                }
            }
        }
        JsonElement children = object.get("children");
        if (children != null && children.isJsonArray()) {
            for (JsonElement child : children.getAsJsonArray()) {
                validateBoneTextureBounds(child, textureWidth, textureHeight, path);
            }
        }
    }

    private static int positiveInt(JsonObject object, String key, String path) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return 1;
        int result = value.getAsInt();
        if (result <= 0) throw new IllegalArgumentException("Texture dimension must be positive in " + path);
        return result;
    }

    private static double number(JsonElement value, String path) {
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException("Model coordinate must be numeric in " + path);
        }
        return value.getAsDouble();
    }

    private static BrClientEntity parseClientEntity(EffectAssetBundle bundle) throws Exception {
        byte[] bytes = bundle.read(bundle.definition().clientEntity());
        JsonElement json = parseJson(bundle.definition().clientEntity(), bytes);
        BrClientEntity entity = BrClientEntity.CODEC.parse(JsonOps.INSTANCE, json).result()
                .orElseThrow(() -> new IllegalArgumentException("Invalid client entity: " + bundle.definition().clientEntity()));
        if (!entity.identifier().startsWith(NAMESPACE + ":")) {
            throw new IllegalArgumentException("Client entity identifier must use " + NAMESPACE + ":");
        }
        requireNamespace(entity.geometry().values(), "geometry");
        for (String animation : entity.animations().values()) {
            if (!animation.startsWith("animation." + NAMESPACE + ".")
                    && !animation.startsWith("controller.animation." + NAMESPACE + ".")) {
                throw new IllegalArgumentException("Animation reference outside VFX namespace: " + animation);
            }
        }
        requireNamespace(entity.render_controllers(), "controller.render");
        for (String particle : entity.particle_effects().values()) {
            if (!particle.startsWith(NAMESPACE + ":")) {
                throw new IllegalArgumentException("Particle reference must use " + NAMESPACE + ": " + particle);
            }
        }
        return entity;
    }

    private static JsonElement parseJson(String path, byte[] bytes) {
        try {
            return JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8));
        } catch (RuntimeException e) {
            throw new PublicationException("Invalid JSON: " + path, e);
        }
    }

    private static void requireNamespace(Collection<String> ids, String prefix) {
        for (String id : ids) {
            if (!id.startsWith(prefix + "." + NAMESPACE + ".")) {
                throw new IllegalArgumentException("eyelib asset id must start with " + prefix + "." + NAMESPACE + ": " + id);
            }
        }
    }

    private static final class Publication {
        final Map<String, Model> models = new LinkedHashMap<>();
        final Map<String, BrClientEntity> entities = new LinkedHashMap<>();
        final Map<String, BrAnimation> animations = new LinkedHashMap<>();
        final Map<String, BrAnimationControllers> controllers = new LinkedHashMap<>();
        final Map<String, io.github.tt432.eyelib.client.render.controller.RenderControllerEntry> renderControllers = new LinkedHashMap<>();
        final Map<String, ParticleDefinition> particles = new LinkedHashMap<>();
        final Map<String, byte[]> textures = new LinkedHashMap<>();
    }

    private static final class Instance implements EffectHandle {
        final LivingEntity carrier;
        final CarrierFactory factory;
        final EffectAssetBundle bundle;
        final long startTick;
        final Set<String> particleIds = new HashSet<>();

        Instance(LivingEntity carrier, CarrierFactory factory, EffectAssetBundle bundle, long startTick) {
            this.carrier = carrier;
            this.factory = factory;
            this.bundle = bundle;
            this.startTick = startTick;
        }

        @Override
        public LivingEntity carrier() {
            return carrier;
        }
    }

    private static final class PublicationException extends RuntimeException {
        PublicationException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
