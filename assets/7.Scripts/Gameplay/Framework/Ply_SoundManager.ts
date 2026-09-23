import { _decorator, Component, Node, AudioClip, AudioSource, Enum, EventHandler } from 'cc';
import { Ply_Singleton } from './Ply_Singleton';

const { ccclass, property } = _decorator;

export enum FxType {
    Click = 0,
    Complete,
    Failed,
    Blink,
    Clean1,
    Clean2,
    StarSpark,
    PlaceTrash,
    CleanItemAppear,
    Aha,
    SoftPlace, PlaceCan, PlaceWood, PlaceMetal, PlaceLeather,
    PlaceBag,
    Swipe
    
    
}
Enum(FxType);

@ccclass('FxAudio')
export class FxAudio {
    @property({ type: Enum(FxType) })
    public fxType: FxType = FxType.Click;

    @property({ type: AudioClip })
    public audioClip: AudioClip = null!;

    @property({ range: [0, 1, 0.05], slide: true })
    public volume: number = 1.0;
    public eventHandler: EventHandler | null = null;
}

@ccclass('Ply_SoundManager')
export class Ply_SoundManager extends Ply_Singleton<Ply_SoundManager> {

    @property({ type: [FxAudio] })
    public fxAudios: FxAudio[] = [];

    @property(AudioSource)
    public bgmSource: AudioSource = null!;

    private sourcesMap: Map<FxType, AudioSource> = new Map();
    private isMuted: boolean = false;

    protected onLoad() {
        super.onLoad();
    }

    public get isMute(): boolean {
        return this.isMuted;
    }

    public set isMute(value: boolean) {
        this.isMuted = value;
        if (value) {
            this.Mute();
        }
    }

    /**
     * Play sound effect once
     */
    public PlayFx(fxType: FxType | number) {
        if (this.isMuted) return;

        const type = fxType as FxType;
        const fxAudio = this.GetFxAudio(type);
        if (!fxAudio || !fxAudio.audioClip) return;

        const source = this.GetOrCreateFxSource(type);
        if (source.loop) {
            source.loop = false;
            source.stop();
        }

        source.playOneShot(fxAudio.audioClip, fxAudio.volume);
    }

    /**
     * Helper for Button Click Event in Editor: Play Click Sound
     */
    public PlayFxClick() {
        this.PlayFx(FxType.Click);
    }

    /** Starts the configured background music once. */
    public PlayBgm(loop: boolean = true) {
        if (this.isMuted || !this.bgmSource || !this.bgmSource.clip) return;
        this.bgmSource.loop = loop;
        if (!this.bgmSource.playing) this.bgmSource.play();
    }

    /**
     * Helper for Button Click Event in Editor: Pass FxType index or name in Custom Event Data
     */
    public PlayFxByCustomData(event: any, customEventData: string) {
        if (!customEventData) {
            this.PlayFx(FxType.Click);
            return;
        }

        const index = parseInt(customEventData);
        if (!isNaN(index)) {
            this.PlayFx(index as FxType);
        } else if (customEventData in FxType) {
            this.PlayFx((FxType as any)[customEventData]);
        }
    }

    /**
     * Play sound effect in loop
     */
    public PlayFxLoop(fxType: FxType | number) {
        if (this.isMuted) return;

        const type = fxType as FxType;
        const fxAudio = this.GetFxAudio(type);
        if (!fxAudio || !fxAudio.audioClip) return;

        const source = this.GetOrCreateFxSource(type);
        source.clip = fxAudio.audioClip;
        source.volume = fxAudio.volume;
        source.loop = true;

        if (!source.playing) {
            source.play();
        }
    }

    /**
     * Stop looping sound effect
     */
    public StopFxLoop(fxType: FxType | number) {
        const type = fxType as FxType;
        const source = this.sourcesMap.get(type);
        if (source) {
            source.loop = false;
            source.stop();
        }
    }

    /**
     * Mute all audio sources
     */
    public Mute() {
        if (this.bgmSource) {
            this.bgmSource.stop();
        }

        this.sourcesMap.forEach((source) => {
            if (source && source.node && source.node.isValid) {
                source.stop();
            }
        });
    }

    /**
     * Get FxAudio configuration by FxType
     */
    private GetFxAudio(fxType: FxType): FxAudio | null {
        if (!this.fxAudios) return null;

        for (let i = 0; i < this.fxAudios.length; i++) {
            if (this.fxAudios[i] && this.fxAudios[i].fxType === fxType) {
                return this.fxAudios[i];
            }
        }
        return null;
    }

    /**
     * Get or instantiate AudioSource component for specified FxType
     */
    private GetOrCreateFxSource(fxType: FxType): AudioSource {
        let source = this.sourcesMap.get(fxType);

        if (!source || !source.node || !source.node.isValid) {
            const childName = `Audio_${FxType[fxType] ?? fxType}`;
            let node = this.node.getChildByName(childName);
            if (!node) {
                node = new Node(childName);
                node.setParent(this.node);
            }

            source = node.getComponent(AudioSource) || node.addComponent(AudioSource);
            this.sourcesMap.set(fxType, source);
        }

        return source;
    }
}
