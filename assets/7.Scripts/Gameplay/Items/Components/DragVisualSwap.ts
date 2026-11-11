import { _decorator, Component, Node } from 'cc';
import { ItemDraggable } from './ItemDraggable';

const { ccclass, property } = _decorator;

/** Đổi hình tool giữa trạng thái nằm yên (Idle) và đang kéo (Drag). */
@ccclass('DragVisualSwap')
export class DragVisualSwap extends Component {
    @property({ type: Node, tooltip: 'Hình hiển thị khi tool nằm yên.' })
    public idleVisual: Node | null = null;

    @property({ type: Node, tooltip: 'Hình hiển thị khi đang kéo tool.' })
    public dragVisual: Node | null = null;

    private draggable: ItemDraggable | null = null;
    private readonly onBegin = () => this.setDragging(true);
    private readonly onEnd = () => this.setDragging(false);

    protected onEnable(): void {
        this.draggable ??= this.getComponent(ItemDraggable);
        this.draggable?.onBeginDrag.addListener(this.onBegin);
        this.draggable?.onDropSuccess.addListener(this.onEnd);
        this.draggable?.onDropFail.addListener(this.onEnd);
        this.setDragging(false);
    }

    protected onDisable(): void {
        this.draggable?.onBeginDrag.removeListener(this.onBegin);
        this.draggable?.onDropSuccess.removeListener(this.onEnd);
        this.draggable?.onDropFail.removeListener(this.onEnd);
    }

    private setDragging(dragging: boolean): void {
        if (this.idleVisual?.isValid) this.idleVisual.active = !dragging;
        if (this.dragVisual?.isValid) this.dragVisual.active = dragging;
    }
}
