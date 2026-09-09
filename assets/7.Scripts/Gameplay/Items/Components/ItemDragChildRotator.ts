import { _decorator, Component, Enum, Node, Quat, tween, Tween, Vec3 } from 'cc';
import { ItemDraggable } from './ItemDraggable';

const { ccclass, property, requireComponent } = _decorator;

/** Easing options exposed in the Inspector for drag rotation. */
export enum DragRotationEase {
    Linear = 0,
    QuadOut,
    BackOut,
}
Enum(DragRotationEase);

/**
 * Rotates a draggable item (or one of its child nodes) while it is dragged.
 * If the drop fails, its original rotation is restored after the draggable
 * component has started the return-to-origin tween.
 */
@ccclass('ItemDragChildRotator')
@requireComponent(ItemDraggable)
export class ItemDragChildRotator extends Component {
    @property({ type: Node, tooltip: 'Child to rotate. Uses this node when empty.' })
    public rotateTarget: Node | null = null;

    @property({ type: Vec3, tooltip: 'Euler angle to use while dragging.' })
    public dragEulerAngles: Vec3 = new Vec3();

    @property({ tooltip: 'Rotate in local space. Disable to rotate in world space.' })
    public useLocalRotation = true;

    @property({ tooltip: 'Add Drag Euler Angles to the original rotation instead of using it directly.' })
    public rotateRelative = false;

    @property({ min: 0, tooltip: 'Rotation tween duration, in seconds.' })
    public rotateDuration = 0.15;

    @property({ type: Enum(DragRotationEase) })
    public rotateEase: DragRotationEase = DragRotationEase.QuadOut;

    private itemDraggable: ItemDraggable | null = null;
    private originalEulerAngles = new Vec3();
    private hasOriginalRotation = false;
    private rotateTween: Tween<Node> | Tween<{ progress: number }> | null = null;

    protected onLoad(): void {
        this.itemDraggable = this.getComponent(ItemDraggable);
        this.CacheOriginalRotation();
    }

    protected onEnable(): void {
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.itemDraggable?.onBeginDrag.addListener(this.RotateOnDrag);
        this.itemDraggable?.onDropFail.addListener(this.HandleDropFail);
    }

    protected onDisable(): void {
        this.itemDraggable?.onBeginDrag.removeListener(this.RotateOnDrag);
        this.itemDraggable?.onDropFail.removeListener(this.HandleDropFail);
        this.unschedule(this.RotateBack);
        this.StopRotationTween();
    }

    public RotateOnDrag = (): void => {
        this.CacheOriginalRotation();
        const targetEuler = this.rotateRelative
            ? Vec3.add(new Vec3(), this.originalEulerAngles, this.dragEulerAngles)
            : this.dragEulerAngles.clone();
        this.RotateTo(targetEuler);
    };

    public RotateBack(): void {
        if (this.hasOriginalRotation) this.RotateTo(this.originalEulerAngles);
    }

    /** Immediately restores the initial rotation; useful for animation events. */
    public ResetToOriginalRotation(): void {
        if (!this.hasOriginalRotation) this.CacheOriginalRotation();
        this.unschedule(this.RotateBack);
        this.StopRotationTween();
        this.SetEulerAngles(this.originalEulerAngles);
    }

    private HandleDropFail = (): void => {
        // ItemDraggable calls onDropFail just before ReturnToStart(). When the
        // rotation target is the draggable node itself, ReturnToStart() stops
        // every tween on that node. Deferring one frame lets its reparent/return
        // tween be created first, so this rotation tween is not cancelled.
        if (this.GetRotateTarget() === this.node) {
            this.unschedule(this.RotateBack);
            this.scheduleOnce(this.RotateBack, 0);
            return;
        }
        this.RotateBack();
    };

    private CacheOriginalRotation(): void {
        if (this.hasOriginalRotation) return;
        const target = this.GetRotateTarget();
        Vec3.copy(this.originalEulerAngles, this.useLocalRotation ? target.eulerAngles : this.GetWorldEulerAngles(target));
        this.hasOriginalRotation = true;
    }

    private RotateTo(targetEulerAngles: Vec3): void {
        const target = this.GetRotateTarget();
        this.StopRotationTween();

        if (this.useLocalRotation) {
            this.rotateTween = tween(target)
                .to(this.rotateDuration, { eulerAngles: targetEulerAngles }, { easing: this.GetEasing() })
                .start();
            return;
        }

        const start = this.GetWorldEulerAngles(target);
        const state = { progress: 0 };
        this.rotateTween = tween(state)
            .to(this.rotateDuration, { progress: 1 }, {
                easing: this.GetEasing(),
                onUpdate: ({ progress }) => {
                    const euler = Vec3.lerp(new Vec3(), start, targetEulerAngles, progress);
                    target.setWorldRotationFromEuler(euler.x, euler.y, euler.z);
                },
            })
            .start();
    }

    private SetEulerAngles(euler: Vec3): void {
        const target = this.GetRotateTarget();
        if (this.useLocalRotation) {
            target.setRotationFromEuler(euler.x, euler.y, euler.z);
        } else {
            target.setWorldRotationFromEuler(euler.x, euler.y, euler.z);
        }
    }

    private GetWorldEulerAngles(target: Node): Vec3 {
        return Quat.toEuler(new Vec3(), target.worldRotation);
    }

    private GetRotateTarget(): Node {
        return this.rotateTarget?.isValid ? this.rotateTarget : this.node;
    }

    private StopRotationTween(): void {
        this.rotateTween?.stop();
        this.rotateTween = null;
    }

    private GetEasing(): string {
        switch (this.rotateEase) {
            case DragRotationEase.BackOut: return 'backOut';
            case DragRotationEase.QuadOut: return 'quadOut';
            default: return 'linear';
        }
    }
}
