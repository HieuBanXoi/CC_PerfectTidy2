import { _decorator, Component } from 'cc';
import { Ply_EventHandlerComponent } from './Ply_EventHandlerComponent';
const { ccclass } = _decorator;

@ccclass('Ply_Singleton')
export class Ply_Singleton<T extends Component> extends Ply_EventHandlerComponent {
    public static Ins: any = null!;

    protected onLoad() {
        const ctor = this.constructor as any;

        if (ctor.Ins != null && ctor.Ins !== this) {
            console.warn(`[Ply_Singleton] Duplicate instance of ${this.node.name} destroyed!`);
            this.node.destroy();
            return;
        }

        ctor.Ins = this;
    }

    /**
     * Scene/preview reloads destroy singleton nodes, but static class fields
     * survive long enough for the next scene to load. Clear the old reference
     * so the replacement component is not mistaken for a duplicate.
     */
    protected onDestroy() {
        const ctor = this.constructor as any;
        if (ctor.Ins === this) {
            ctor.Ins = null;
        }
    }
}
