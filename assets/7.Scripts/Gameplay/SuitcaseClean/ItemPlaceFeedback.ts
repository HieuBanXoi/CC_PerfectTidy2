import { _decorator, Component, Enum, Node } from 'cc';
import { ItemSpawnManager } from '../Items/Snapping/ItemSpawnManager';
import { ItemSnap } from '../Items/Snapping/ItemSnap';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';
import { World } from '../../Core/Managers/World';
import { PoolType } from '../../Core/Pooling/PoolMember';
import type { HeartEffect } from '../Effects/HeartEffect';

const { ccclass, property } = _decorator;

/**
 * Phản hồi khi xếp đồ: xếp đúng thì phát sound aha (tuỳ chọn) + spawn heart; sound drop riêng của từng món
 * là ItemSnap.fxTypeOnPlace. Xếp sai (thả không trúng chỗ) thì phát sound sai.
 */
@ccclass('ItemPlaceFeedback')
export class ItemPlaceFeedback extends Component {
    @property({ type: ItemSpawnManager, tooltip: 'Lấy danh sách đồ từ dynamicItems. Để trống: ItemSpawnManager.Ins.' })
    public itemSpawnManager: ItemSpawnManager | null = null;

    @property({ tooltip: 'Spawn heart khi xếp đúng.' })
    public spawnHeartOnPlace = true;

    @property({ min: 0, tooltip: 'Hệ số scale heart.' })
    public heartScale = 1.2;

    @property({ tooltip: 'Phát thêm sound aha khi xếp đúng (sound drop riêng của từng món vẫn là ItemSnap.fxTypeOnPlace).' })
    public playAhaOnPlace = true;

    @property({ type: Enum(FxType), tooltip: 'Sound aha khi xếp đúng.', visible(this: ItemPlaceFeedback) { return this.playAhaOnPlace; } })
    public ahaFxType: FxType = FxType.Aha;

    @property({ type: Enum(FxType), tooltip: 'Sound khi xếp sai.' })
    public wrongFxType: FxType = FxType.Failed;

    protected start(): void {
        const spawner = this.itemSpawnManager ?? ItemSpawnManager.Ins as ItemSpawnManager | null;
        spawner?.dynamicItems.forEach(item => this.bind(item));
    }

    private bind(item: ItemSnap | null): void {
        if (!item) return;
        // Heart gắn vào chính món đồ để luôn vẽ đè lên món đồ vừa đặt.
        item.onPlacedSuccess.addListener(() => {
            if (this.playAhaOnPlace) Ply_SoundManager.Ins?.PlayFx(this.ahaFxType);
            this.spawnHeart(item.node);
        });
        item.onPlacedFail.addListener(() => Ply_SoundManager.Ins?.PlayFx(this.wrongFxType));
    }

    private spawnHeart(target: Node): void {
        if (!this.spawnHeartOnPlace || !target?.isValid) return;
        const heart = World.instance?.poolManager?.spawnType<HeartEffect>(PoolType.HeartFX, target.worldPosition);
        if (!heart) return;
        heart.node.setParent(target);
        heart.node.setPosition(0, 0, 0);
        heart.PlaySpawnWithScale(this.heartScale);
    }
}
