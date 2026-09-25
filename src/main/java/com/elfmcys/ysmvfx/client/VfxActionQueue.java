package com.elfmcys.ysmvfx.client;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Predicate;

/** Client-thread commands captured by animation evaluation and applied after entity ticking. */
final class VfxActionQueue {
    private static final int CAPACITY = 1024;
    private final List<Action> pending = new ArrayList<>();
    private final Map<Key, Boolean> pendingSlots = new HashMap<>();

    synchronized boolean play(UUID source, String effect, String slot) {
        if (source == null || effect == null || effect.isBlank() || !validSlot(slot)
                || pending.size() >= CAPACITY) {
            return false;
        }
        Key key = new Key(source, slot);
        pending.add(new Play(key, effect));
        pendingSlots.put(key, true);
        return true;
    }

    synchronized boolean stop(UUID source, String slot, Predicate<Key> active) {
        if (source == null || !validSlot(slot) || pending.size() >= CAPACITY) {
            return false;
        }
        Key key = new Key(source, slot);
        if (!hasSlot(key, active)) {
            return false;
        }
        pending.add(new Stop(key));
        pendingSlots.put(key, false);
        return true;
    }

    synchronized boolean set(UUID source, String slot, String name, double value, Predicate<Key> active) {
        if (source == null || !validSlot(slot) || !validParameter(name, value)
                || pending.size() >= CAPACITY) {
            return false;
        }
        Key key = new Key(source, slot);
        if (!hasSlot(key, active)) {
            return false;
        }
        pending.add(new SetParameter(key, name, value));
        return true;
    }

    private boolean hasSlot(Key key, Predicate<Key> active) {
        Boolean projected = pendingSlots.get(key);
        return projected != null ? projected : active.test(key);
    }

    synchronized List<Action> drain() {
        List<Action> result = List.copyOf(pending);
        clear();
        return result;
    }

    synchronized void clear() {
        pending.clear();
        pendingSlots.clear();
    }

    synchronized int size() {
        return pending.size();
    }

    static boolean validSlot(String slot) {
        return slot != null && !slot.isBlank() && slot.length() <= 64;
    }

    static boolean validParameter(String name, double value) {
        return name != null && !name.isBlank() && name.length() <= 64
                && name.matches("[A-Za-z0-9_.-]+") && Double.isFinite(value);
    }

    record Key(UUID sourceId, String slot) { }

    sealed interface Action permits Play, Stop, SetParameter {
        Key key();
    }

    record Play(Key key, String effectId) implements Action { }
    record Stop(Key key) implements Action { }
    record SetParameter(Key key, String name, double value) implements Action { }
}
