import { JobService } from "../application/job-service";
import { JobWorker } from "../application/job-worker";
import { OrbitQuestionService } from "../application/orbit-question-service";
import { LocalJobController } from "../http/local-job-controller";
import { CompanyOrbitQuestionGenerator } from "./company-orbit-question-generator";
import { getJobRuntimeConfig } from "./job-config";
import { LocalJobExecutor } from "./local-job-executor";
import { SqliteJobRepository } from "./sqlite-job-repository";

export interface LocalJobSystem {
  controller: LocalJobController;
  close(): Promise<void>;
}

export function createLocalJobSystem(): LocalJobSystem {
  const config = getJobRuntimeConfig();
  const repository = new SqliteJobRepository(config.databasePath);
  const executor = new LocalJobExecutor(config);
  const service = new JobService(repository, executor, config);
  const worker = new JobWorker(repository, executor, service);
  const orbitQuestions = new OrbitQuestionService(new CompanyOrbitQuestionGenerator());
  const controller = new LocalJobController(service, orbitQuestions);
  worker.start();
  return {
    controller,
    close: async () => {
      await worker.stop();
      repository.close();
    },
  };
}
