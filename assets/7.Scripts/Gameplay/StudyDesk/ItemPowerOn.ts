import { _decorator, Component, Enum, Node, Tween, tween, UIOpacity } from 'cc';
import { ItemSnap } from '../Items/Snapping/ItemSnap';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';

const { ccclass, property } = _decorator;

/**
 * Đồ điện (đèn bàn, laptop...): ẩn các node "on" lúc đầu, xếp đúng chỗ (ItemSnap.onPlacedSuccess)
 * thì bật các node đó lên kèm hiệu ứng nháy sáng.
 * Gắn cùng node với ItemSnap.
 */
@ccclass('ItemPowerOn')
export class ItemPowerOn extends Component {
    @property({ type: [Node], tooltip: 'Các node trạng thái bật (ví dụ study_lamp_on, Laptop_on). Ẩn lúc đầu.' })
    public onNodes: Node[] = [];

    @property({ min: 0, tooltip: 'Chờ (giây) sau khi đặt đúng rồi mới bật (đợi item snap vào chỗ).' })
    public delay = 0.25;

    @property({ min: 0, step: 1, tooltip: 'Số lần nháy trước khi sáng hẳn. 0 = sáng dần luôn.' })
    public flickerCount = 2;

    @property({ min: 0.01, tooltip: 'Thời gian 1 lần nháy / sáng dần (giây).' })
    public flickerDuration = 0.08;

    @property({ tooltip: 'Phát sound khi bật.' })
    public playSound = false;

    @property({ type: Enum(FxType), tooltip: 'Sound khi bật.', visible(this: ItemPowerOn) { return this.playSound; } })
    public fxType: FxType = FxType.Click;

    private _snap: ItemSnap | null = null;
    private _isOn = false;
    private readonly _onPlaced = () => this.scheduleOnce(() => this.TurnOn(), this.delay);

    protected onLoad(): void {
        this._snap = this.getComponent(ItemSnap);
        this.onNodes.forEach(node => { if (node) node.active = false; });
    }

    protected onEnable(): void {
        this._snap?.onPlacedSuccess.addListener(this._onPlaced);
    }

    protected onDisable(): void {
        this._snap?.onPlacedSuccess.removeListener(this._onPlaced);
    }

    public TurnOn(): void {
        if (this._isOn) return;
        this._isOn = true;
        if (this.playSound) Ply_SoundManager.Ins?.PlayFx(this.fxType);
        for (const node of this.onNodes) {
            if (!node) continue;
            const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
            Tween.stopAllByTarget(opacity);
            node.active = true;
            opacity.opacity = 0;
            const d = this.flickerDuration;
            let t = tween(opacity);
            for (let i = 0; i < this.flickerCount; i++) {
                t = t.to(d, { opacity: 255 }).to(d, { opacity: 60 });
            }
            t.to(d * 2, { opacity: 255 }, { easing: 'sineOut' }).start();
        }
    }
}
