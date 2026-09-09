import { _decorator, Node } from 'cc';
import { Ply_EventHandlerComponent } from './Ply_EventHandlerComponent';
const { ccclass } = _decorator;

@ccclass('Ply_GameUnit')
export class Ply_GameUnit extends Ply_EventHandlerComponent {

    public get tf(): Node {
        return this.node;
    }

    /**
     * Called when retrieved from Pool (Spawn)
     */
    reuse() {
    }

    /**
     * Called when returned to Pool (Despawn)
     */
    unuse() {
    }
}
