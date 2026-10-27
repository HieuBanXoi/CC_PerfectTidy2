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
    Clipper,
    HairCut,
    Towel,
    Cat,
    Soap,
    SoapClean,
    BlowDryer,
    WaterStream,
    Wipe,
    Shovel,
    SprayPuff,
    Tear,
    WetWipeRub,
    Aha,
    PlaceItem,

}
Enum(FxType);

@ccclass('FxAudio')
export class FxAudio {
    @property({ type: Enum(FxType) })
    public fxType: FxType = FxType.Click;

    @property({ type: AudioClip })
    public audioClip: AudioClip = null!;

    @property({ range: [0, 3, 0.05], slide: true, tooltip: '> 1: phát chồng nhiều lớp cùng lúc để to hơn (AudioSource chỉ cho tối đa 1).' })
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
    /** AudioSource phụ cho loop có volume > 1. */
    private boostSourcesMap: Map<FxType, AudioSource[]> = new Map();
    /** Các FxType đang phát loop (tự theo dõi, không dùng AudioSource.playing). */
    private loopingTypes: Set<FxType> = new Set();
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
        if (source.loop) this.StopFxLoop(type);

        // Volume > 1: phát chồng nhiều lớp, mỗi lớp <= 1.
        const layers = Math.max(1, Math.ceil(fxAudio.volume));
        for (let i = 0; i < layers; i++) {
            source.playOneShot(fxAudio.audioClip, fxAudio.volume / layers);
        }
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
        // Đang loop sẵn thì thôi. Không dựa vào source.playing: trên web nó cập nhật trễ
        // sau stop(), làm lần phát loop thứ 2 bị bỏ qua (mất sfx khi kéo đồ lần 2).
        if (this.loopingTypes.has(type)) return;

        // Volume > 1: thêm các AudioSource phụ loop cùng clip, mỗi lớp <= 1.
        const layers = Math.max(1, Math.ceil(fxAudio.volume));
        const sources = [source, ...this.GetBoostSources(type, layers - 1)];
        for (const layer of sources) {
            layer.clip = fxAudio.audioClip;
            layer.volume = fxAudio.volume / layers;
            layer.loop = true;
            layer.stop();
            layer.play();
        }
        this.loopingTypes.add(type);
    }

    /**
     * Stop looping sound effect
     */
    public StopFxLoop(fxType: FxType | number) {
        const type = fxType as FxType;
        this.loopingTypes.delete(type);
        const source = this.sourcesMap.get(type);
        for (const layer of [source, ...(this.boostSourcesMap.get(type) ?? [])]) {
            if (!layer) continue;
            layer.loop = false;
            layer.stop();
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
        this.boostSourcesMap.forEach((sources) => sources.forEach((source) => {
            if (source && source.node && source.node.isValid) {
                source.stop();
            }
        }));
        this.loopingTypes.clear();
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

    /** Lấy (hoặc tạo thêm) count AudioSource phụ của FxType để loop chồng lớp. */
    private GetBoostSources(fxType: FxType, count: number): AudioSource[] {
        const sources = (this.boostSourcesMap.get(fxType) ?? []).filter(s => s && s.node && s.node.isValid);
        while (sources.length < count) {
            const node = new Node(`Audio_${FxType[fxType] ?? fxType}_Boost${sources.length + 1}`);
            node.setParent(this.node);
            sources.push(node.addComponent(AudioSource));
        }
        this.boostSourcesMap.set(fxType, sources);
        return sources.slice(0, count);
    }
}
