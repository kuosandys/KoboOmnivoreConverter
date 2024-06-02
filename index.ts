import dotenv from "dotenv";
import express, { NextFunction, type Request, type Response } from "express";
import { type TypedRequestBody } from "./types/Express";
import { OmnivoreClient } from "./lib/omnivoreClient";
import {
  convertSearchResultsToPocketArticles,
  articleToPocketFormat,
} from "./lib/pocketConverter";

dotenv.config();

const proxyApp = express();

let omnivoreClient: null | OmnivoreClient = null;
const getOmnivoreClient = async (
  token: string | undefined
): Promise<OmnivoreClient> => {
  if (!omnivoreClient) {
    omnivoreClient = await OmnivoreClient.createOmnivoreClient(
      token ?? process.env.FALLBACK_TOKEN!
    );
  }

  return omnivoreClient;
};

const replaceContentType = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const contentType = req.headers["content-type"];
  if (contentType && contentType.includes("charset=UTF8")) {
    // wrong charset
    req.headers["content-type"] = contentType.replace("UTF8", "UTF-8");
  }
  next();
};

const logErrors = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error(err.stack);
  res.status(500).send();
};

// deliberately ignoring errors from async operations (i.e. to Omnivore API), otherwise the whole sync operation fails
const asyncWrapper =
  (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    return Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error(err.stack);
      next(err);
    });
  };

proxyApp.use(replaceContentType);
proxyApp.use(express.json());
proxyApp.use(express.urlencoded({ extended: true }));
proxyApp.use(logErrors);

proxyApp.post(
  "/v3/send",
  asyncWrapper(
    async (
      req: TypedRequestBody<{
        actions: Array<{ action: string; item_id: string }>;
        access_token: string;
      }>,
      res: Response
    ): Promise<void> => {
      const { access_token, actions } = req.body;

      const client = await getOmnivoreClient(access_token);

      const toArchive = actions
        .filter((it) => it.action === "archive")
        .map((it) => it.item_id);

      const toDelete = actions
        .filter((it) => it.action === "delete")
        .map((it) => it.item_id);

      await Promise.all([
        ...toArchive.map(client.archiveLink, client),
        ...toDelete.map(client.deleteLink, client),
      ]);

      res.send({ action_results: [] });
    }
  )
);

proxyApp.post(
  "/v3/get",
  asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { access_token } = req.body;

    const client = await getOmnivoreClient(access_token);
    const articles = await client.fetchPages();
    const converted = convertSearchResultsToPocketArticles(articles);

    res.send(converted);
  })
);

proxyApp.post(
  "/v3beta/text",
  asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { access_token, url } = req.body;

    const client = await getOmnivoreClient(access_token);
    const article = await client.fetchPage(url);

    res.send(articleToPocketFormat(article));
  })
);

proxyApp.get("/beep", async (_req: Request, res: Response): Promise<void> => {
  res.status(200).send("boop");
});

const port = process.env.PORT ?? 80;
proxyApp.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default proxyApp;
