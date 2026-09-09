import { _decorator, animation, Component } from 'cc';

const { ccclass, property } = _decorator;

/**
 * EventHandler-friendly facade for Cocos Animation Controller triggers.
 * Set Custom Event Data to the trigger name, e.g. "Get".
 */
@ccclass('AnimationControllerHelper')
export class AnimationControllerHelper extends Component {
    @property({ type: animation.AnimationController, tooltip: 'Controller to control. Defaults to an Animation Controller on this Node.' })
    public animationController: animation.AnimationController | null = null;

    protected onLoad(): void {
        if (!this.animationController) {
            this.animationController = this.getComponent(animation.AnimationController);
        }
    }

    /** EventHandler callback: calls AnimationController.setValue(triggerName, true). */
    public PlayTrigger(triggerName: string): void {
        const trigger = triggerName?.trim();
        if (!trigger) {
            console.warn('[AnimationControllerHelper] PlayTrigger requires a trigger name.');
            return;
        }

        const controller = this.animationController ?? this.getComponent(animation.AnimationController);
        if (!controller) {
            console.warn(`[AnimationControllerHelper] Animation Controller is missing on '${this.node.name}'.`);
            return;
        }

        controller.setValue(trigger, true);
    }
}
