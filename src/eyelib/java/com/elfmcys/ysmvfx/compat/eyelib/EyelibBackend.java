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
import io.github.tt432.eyelib.animation.bedrock.BrAnimation;
import io.github.tt432.eyelib.animation.bedrock.controller.BrAnimationControllers;
import io.github.tt432.eyelib.bridge.client.render.texture.NativeImagePort;
import io.github.tt432.eyelib.bridge.particle.ParticlePort;
import io.github.tt432.eyelib.capability.RenderData;
import io.github.tt432.eyelib.client.manager.ClientEntityManager;
import io.github.tt432.eyelib.client.manager.ModelManager;
import io.github.tt432.eyelib.client.manager.RenderControllerManager;
import io.github.tt432.eyelib.client.particle.RootAnimationParticleSpawner;
import io.github.tt432.eyelib.client.render.EntityRenderOrchestrator;
import io.github.tt432.eyelib.client.render.controller.RenderControllers;
import io.github.tt432.eyelib.client.registry.AnimationAssetRegistry;
import io.github.tt432.eyelib.importer.animation.bedrock.BrAnimationSet;
import io.github.tt432.eyelib.importer.animation.bedrock.controller.BrAnimationControllerSet;
import io.github.tt432.eyelib.importer.entity.BrClientEntity;
import io.github.tt432.eyelib.importer.model.importer.BedrockGeometryImporter;
import io.github.tt432.eyelib.importer.particle.BrParticle;
import io.github.tt432.eyelib.model.Model;
import io.github.tt432.eyelib.particle.loading.ParticleResourcePublication;
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
    private static final Object ANIMATION_SOURCE = "yesstevevfx";

    private final Map<EffectHandle, Instance> instances = new LinkedHashMap<>();
    private final Set<String> ownedModelIds = new HashSet<>();
    private final Set<String> ownedEntityIds = new HashSet<>();
    private final Set<String> ownedRenderControllerIds = new HashSet<>();
    private final Set<String> ownedAnimationIds = new HashSet<>();
    private final Set<String> ownedControllerIds = new HashSet<>();
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
        AnimationAssetRegistry.stageAnimations(ANIMATION_SOURCE, publication.animations);
        AnimationAssetRegistry.stageControllers(ANIMATION_SOURCE, publication.controllers);
        ParticleResourcePublication.replaceFromJsonResources(ANIMATION_SOURCE,
                publication.particles, LOGGER);
        publication.textures.forEach((id, bytes) -> {
            try {
                NativeImagePort.loadAndUpload(id, new ByteArrayInputStream(bytes));
            } catch (Exception e) {
                throw new PublicationException("Cannot upload texture " + id, e);
            }
        });
        if (!publication.textures.isEmpty()) {
            NativeImagePort.evictDerivedTextures();
        }

        ownedModelIds.addAll(publication.models.keySet());
        ownedEntityIds.addAll(publication.entities.keySet());
        ownedRenderControllerIds.addAll(publication.renderControllers.keySet());
        publication.animations.values().forEach(value -> ownedAnimationIds.addAll(value.animations().keySet()));
        publication.controllers.values().forEach(value -> ownedControllerIds.addAll(value.animationControllers().keySet()));
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
        RenderData<?> data = RenderData.getComponent(carrier);
        data.ensureOwner(carrier);
        BrClientEntity clientEntity = parseClientEntity(bundle);
        EntityRenderOrchestrator.setupClientEntity(clientEntity, data).forEach(Runnable::run);

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
        clearTrackedParticles(instance.carrier);
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
        instance.carrier.moveTo(request.position().x, request.position().y, request.position().z,
                request.yaw(), request.pitch());
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

    private static void clearTrackedParticles(LivingEntity carrier) {
        RenderData<?> data = RenderData.getComponent(carrier);
        data.ensureOwner(carrier);
        AnimationComponent animation = data.getAnimationComponent();
        RootAnimationParticleSpawner.removeTracked(animation, ParticlePort.getSpawnAdapter());
        RootAnimationParticleSpawner.flushOrphaned(animation, ParticlePort.getSpawnAdapter());
    }

    private void removeOwnedResources() {
        // Clear source slots as well as live registries. Otherwise a future reload
        // from another source would flush the old staged VFX assets back in.
        AnimationAssetRegistry.stageAnimations(ANIMATION_SOURCE, Map.of());
        AnimationAssetRegistry.stageControllers(ANIMATION_SOURCE, Map.of());
        ParticleResourcePublication.replaceFromJsonResources(ANIMATION_SOURCE, Map.of(), LOGGER);
        ModelManager.INSTANCE.removeAll(ownedModelIds);
        ClientEntityManager.INSTANCE.removeAll(ownedEntityIds);
        RenderControllerManager.INSTANCE.removeAll(ownedRenderControllerIds);
        io.github.tt432.eyelib.animation.AnimationRegistries.animation().removeAll(ownedAnimationIds);
        io.github.tt432.eyelib.animation.AnimationRegistries.animation().removeAll(ownedControllerIds);
        ownedModelIds.clear();
        ownedEntityIds.clear();
        ownedRenderControllerIds.clear();
        ownedAnimationIds.clear();
        ownedControllerIds.clear();
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
                    result.particles.put(path, json);
                } else if (path.startsWith("assets/eyelib/textures/") && path.endsWith(".png")) {
                    String relative = path.substring("assets/eyelib/".length());
                    result.textures.put(NAMESPACE + ":" + relative, file.getValue().clone());
                }
            }
        }
        return result;
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
        requireNamespace(entity.animations().values(), "animation");
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
        final Map<String, JsonElement> particles = new LinkedHashMap<>();
        final Map<String, byte[]> textures = new LinkedHashMap<>();
    }

    private static final class Instance implements EffectHandle {
        final LivingEntity carrier;
        final CarrierFactory factory;
        final EffectAssetBundle bundle;
        final long startTick;

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
