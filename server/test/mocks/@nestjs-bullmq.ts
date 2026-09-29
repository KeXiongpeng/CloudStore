export const BullModule = {
  forRoot: () => ({ module: class {}, providers: [], exports: [], imports: [] }),
  registerQueue: () => ({ module: class {}, providers: [], exports: [], imports: [] }),
};
export const Processor = (): ClassDecorator => (target) => target;
export class WorkerHost {}
