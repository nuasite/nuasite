import { defineCmsCollection, n } from '@nuasite/cms'

export const posts = defineCmsCollection({ schema: n.object({ title: n.text() }) })
