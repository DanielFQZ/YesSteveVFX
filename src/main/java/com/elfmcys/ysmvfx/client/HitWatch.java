package com.elfmcys.ysmvfx.client;

import java.util.HashSet;
import java.util.Set;

/** One animation-defined confirmed-hit window. */
final class HitWatch {
    private final String sound;
    private final String effect;
    private final String effectSlot;
    private final Set<Long> sequences = new HashSet<>();

    HitWatch(String sound, String effect, String effectSlot) {
        this.sound = sound;
        this.effect = effect;
        this.effectSlot = effectSlot;
    }

    String sound() { return sound; }
    String effect() { return effect; }
    String effectSlot() { return effectSlot; }

    boolean accept(long sequence) {
        if (sequences.size() >= 256) sequences.clear();
        return sequences.add(sequence);
    }
}
