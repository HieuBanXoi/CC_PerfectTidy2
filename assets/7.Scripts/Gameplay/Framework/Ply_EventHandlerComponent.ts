import { _decorator, Component } from 'cc';

const { ccclass } = _decorator;

@ccclass('Ply_EventHandlerComponent')
export class Ply_EventHandlerComponent extends Component {

    public Activate(): void {
        this.node.active = true;
    }

    public Deactivate(): void {
        this.node.active = false;
    }

    public EnableComponent(): void {
        this.enabled = true;
    }

    public DisableComponent(): void {
        this.enabled = false;
    }
}
