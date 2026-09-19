import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "./tui/app"
import { resolveRoot, UnionRuntime } from "./core/runtime"
import { DashboardServer } from "./services/dashboard-server"

const root = resolveRoot(process.argv[2])
const runtime = new UnionRuntime(root)

await runtime.start()
const dashboard = new DashboardServer(runtime)
dashboard.start()

const renderer = await createCliRenderer({
  targetFps: 30,
  exitOnCtrlC: false,
  useKittyKeyboard: {},
  autoFocus: true,
  useMouse: true,
})

renderer.once("destroy", () => {
  void Promise.all([dashboard.close(), runtime.close()]).finally(() => process.exit(0))
})

await render(() => <App runtime={runtime} />, renderer)
