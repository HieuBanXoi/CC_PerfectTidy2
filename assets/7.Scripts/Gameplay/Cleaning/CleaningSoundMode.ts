import { Enum } from 'cc';

/** Controls when a cleaning tool's drag loop is audible. */
export enum CleaningSoundMode {
    Always = 0,
    TargetOnly = 1,
}
Enum(CleaningSoundMode);
