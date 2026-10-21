import { _decorator, Component, Enum, Node, Tween, tween, UIOpacity, Vec3 } from 'cc';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { ItemSpawnManager } from '../Items/Snapping/ItemSpawnManager';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';
import { World } from '../../Core/Managers/World';
import { PoolType } from '../../Core/Pooling/PoolMember';
import { StarSpark } from '../Effects/StarSpark';

const { ccclass, property } = _decorator;

/**
 * Sau khi dọn xong vali (ItemCleanManager.onAllItemsCleaned): vali đóng biến mất, vali mở hiện lên,
 * rồi ItemSpawnManager spawn toàn bộ đồ. Xếp đủ maxPlacedItemsToWin món thì ItemSpawnManager tự StopGame + GotoStore.
 */
@ccclass('SuitcaseOpenTransition')
export class SuitcaseOpenTransition extends Component {
    @property({ type: ItemCleanManager, tooltip: 'Để trống: ItemCleanManager.Ins.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: ItemSpawnManager, tooltip: 'Để trống: ItemSpawnManager.Ins.' })
    public itemSpawnManager: ItemSpawnManager | null = null;

    @property({ type: Node, tooltip: 'Vali đóng (đã dọn sạch).' })
    public closedSuitcase: Node | null = null;

    @property({ type: Node, tooltip: 'Vali mở (open_suitcase). Ẩn lúc đầu.' })
    public openSuitcase: Node | null = null;

    @property({ type: [Node], tooltip: 'Các node hiện cùng vali mở (ví dụ Holder chứa bóng các món đồ). Ẩn lúc đầu.' })
    public showWithOpen: Node[] = [];

    @property({ min: 0, tooltip: 'Chờ (giây) sau khi dọn xong rồi mới đổi vali.' })
    public startDelay = 0.2;

    @property({ min: 0.01, tooltip: 'Thời gian rung lắc của vali đóng trước khi bật mở (giây).' })
    public shakeDuration = 0.3;

    @property({ min: 0, tooltip: 'Góc rung lắc (độ) của vali đóng.' })
    public shakeAngle = 4;

    @property({ min: 0.01, tooltip: 'Thời gian nắp vali bật mở (giây).' })
    public swapDuration = 0.45;

    @property({ type: Enum(FxType), tooltip: 'Sound khi vali bật mở.' })
    public openFxType: FxType = FxType.Blink;

    @property({ tooltip: 'Bắn hiệu ứng sao lấp lánh khi vali mở.' })
    public playOpenVfx = true;

    @property({ min: 0, tooltip: 'Chờ (giây) sau khi vali mở hiện xong rồi mới spawn đồ.' })
    public spawnDelay = 0.1;

    @property({ tooltip: 'Spawn toàn bộ đồ cùng lúc (bỏ qua initialSpawnCount của ItemSpawnManager).' })
    public spawnAllItems = true;

    private _started = false;
    private readonly _onAllCleaned = () => this.Play();

    protected onLoad(): void {
        if (this.openSuitcase) this.openSuitcase.active = false;
        this.showWithOpen.forEach(node => { if (node) node.active = false; });
    }

    protected onEnable(): void {
        this.Manager?.onAllItemsCleaned.addListener(this._onAllCleaned);
    }

    protected onDisable(): void {
        this.Manager?.onAllItemsCleaned.removeListener(this._onAllCleaned);
    }

    public Play(): void {
        if (this._started) return;
        this._started = true;
        this.scheduleOnce(() => this.hideClosed(() => this.showOpen(() => {
            this.scheduleOnce(() => this.spawnItems(), this.spawnDelay);
        })), this.startDelay);
    }

    private hideClosed(onComplete: () => void): void {
        const node = this.closedSuitcase;
        if (!node?.activeInHierarchy) {
            onComplete();
            return;
        }
        const opacity = this.getOpacity(node);
        const scale = node.scale.clone();
        const angle = node.angle;
        const s = (x: number, y: number) => new Vec3(scale.x * x, scale.y * y, scale.z);
        const shake = this.shakeDuration / 4;
        Tween.stopAllByTarget(node);
        // Lấy đà: vali bẹp xuống, rung lắc như sắp bật nắp, rồi vươn lên và biến mất.
        tween(node)
            .to(0.15, { scale: s(1.08, 0.9) }, { easing: 'quadOut' })
            .to(shake, { angle: angle + this.shakeAngle })
            .to(shake * 2, { angle: angle - this.shakeAngle })
            .to(shake, { angle })
            .to(0.12, { scale: s(0.94, 1.12) }, { easing: 'quadIn' })
            .call(() => {
                node.active = false;
                node.setScale(scale);
                opacity.opacity = 255;
                onComplete();
            })
            .start();
        tween(opacity)
            .delay(0.15 + this.shakeDuration)
            .to(0.12, { opacity: 0 })
            .start();
    }

    private showOpen(onComplete: () => void): void {
        const node = this.openSuitcase;
        if (!node) {
            this.showWithOpen.forEach(n => { if (n) n.active = true; });
            onComplete();
            return;
        }
        const scale = node.scale.clone();
        const s = (x: number, y: number) => new Vec3(scale.x * x, scale.y * y, scale.z);
        const opacity = this.getOpacity(node);
        node.active = true;
        // Nắp bật ra từ bản lề giữa vali: giãn theo chiều dọc, nảy quá đà rồi về đúng kích thước.
        node.setScale(s(1.06, 0.3));
        opacity.opacity = 0;
        Ply_SoundManager.Ins?.PlayFx(this.openFxType);
        this.spawnOpenVfx(node);
        tween(opacity).to(this.swapDuration * 0.3, { opacity: 255 }).start();
        tween(node)
            .to(this.swapDuration * 0.6, { scale: s(0.97, 1.06) }, { easing: 'quadOut' })
            .to(this.swapDuration * 0.4, { scale }, { easing: 'sineInOut' })
            .call(() => {
                this.showWithOpen.forEach(n => { if (n) n.active = true; });
                onComplete();
            })
            .start();
    }

    private spawnOpenVfx(node: Node): void {
        if (!this.playOpenVfx) return;
        const effect = World.instance?.poolManager?.spawnType<StarSpark>(PoolType.StarVFX, node.worldPosition);
        if (!effect) return;
        effect.node.setParent(node.parent);
        effect.node.setWorldPosition(node.worldPosition);
        effect.node.setSiblingIndex(node.parent!.children.length - 1);
        effect.PlaySpawn();
    }

    private spawnItems(): void {
        const spawner = this.itemSpawnManager ?? ItemSpawnManager.Ins as ItemSpawnManager | null;
        if (!spawner) {
            console.warn('[SuitcaseOpenTransition] Không có ItemSpawnManager để spawn đồ.');
            return;
        }
        if (this.spawnAllItems) spawner.initialSpawnCount = Math.max(1, spawner.GetRemainingItemCount());
        spawner.RevealInitialItems();
    }

    private getOpacity(node: Node): UIOpacity {
        return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    }

    private get Manager(): ItemCleanManager | null {
        return this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
    }
}
