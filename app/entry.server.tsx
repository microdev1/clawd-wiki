import { isbot } from 'isbot'
import { renderToReadableStream } from 'react-dom/server.edge'
import type { AppLoadContext, EntryContext } from 'react-router'
import { ServerRouter } from 'react-router'

export const streamTimeout = 5_000

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext
) {
  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders
    })
  }

  const userAgent = request.headers.get('user-agent')
  const waitForAll = (userAgent !== null && isbot(userAgent)) || routerContext.isSpaMode

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), streamTimeout + 1000)

  let shellRendered = false
  const stream = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: controller.signal,
      onError(error: unknown) {
        if (shellRendered) {
          responseStatusCode = 500
          console.error(error)
        }
      }
    }
  )
  shellRendered = true

  if (waitForAll) await stream.allReady

  void stream.allReady.finally(() => clearTimeout(timeoutId))

  responseHeaders.set('Content-Type', 'text/html')
  return new Response(stream, { headers: responseHeaders, status: responseStatusCode })
}
