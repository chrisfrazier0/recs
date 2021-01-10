class RECS {
    constructor() {
        this.id = 0
        this.nextID = 1

        this.entitiesAll = []
        this.entities = new Map()
        this.entitiesByName = new Map()

        this.runlevels = new Map()
        this.queries = new Map()
    }

    registerComponent(component) {
        if (!component.id) {
            component.id = this.nextID++
        }
        return this
    }

    registerSystem(system) {
        if (!system.id) {
            system.id = this.nextID++
        }
        return this
    }

    createEntity(name) {
        if (name && this.entitiesByName.has(name)) {
            throw new Error('duplicate name')
        }

        const entity = new Entity(this.nextID++, this)
        this.entitiesAll.push(entity)
        this.entities.set(entity.id, entity)
        if (name) {
            entity.name = name
            this.entitiesByName.set(entity.name, entity)
        }
        return entity
    }

    getEntity(name) {
        if (typeof name === 'string') {
            return this.entitiesByName.get(name)
        }
        return this.entities.get(name)
    }

    removeEntity(name) {
        const entity = this.getEntity(name)
        if (!entity) {
            throw new Error('unknown entity')
        }

        this.entities.delete(entity.id)
        this.entitiesByName.delete(entity.name)
        this.entitiesAll.splice(this.entitiesAll.indexOf(entity), 1)

        this.queries.forEach(q => q.delete(entity))
        return this
    }

    runlevel(id) {
        let r = this.runlevels.get(id)
        if (!r) {
            r = new Runlevel(id, this)
            this.runlevels.set(id, r)
        }
        return r
    }

    createQuery(config) {
        const { AND,OR,NOT,qid } = Query.parse(this, config)

        if (config.ALL === 'true' || config.all === 'true' || !qid) {
            config.id = 'ALL'
            config.results = this.entitiesAll
            return config
        }

        let query = this.queries.get(qid)
        if (!query) {
            query = new Query(qid, AND, OR, NOT)
            this.queries.set(qid, query)
            this.entities.forEach(e => query.test(e))
        } else {
            query.count += 1
        }

        config.id = qid
        config.results = query.entities
        return config
    }

    removeQuery(config) {
        if (config.id === 'ALL') {
            return this
        }

        const { qid } = Query.parse(this, config)
        const query = this.queries.get(qid)

        if (query) {
            query.count -= 1
            if (query.count <= 0) {
                this.queries.delete(qid)
            }
        }
        return this
    }

    updateQueries(entity) {
        this.queries.forEach(q => q.test(entity))
        return this
    }

    addSystem(system, ...opts) {
        this.runlevel(0).addSystem(system, ...opts)
        return this
    }

    hasSystem(system) {
        return this.runlevel(0).hasSystem(system)
    }

    getSystem(system) {
        return this.runlevel(0).getSystem(system)
    }

    removeSystem(system) {
        this.runlevel(0).removeSystem(system)
        return this
    }

    execute(...opts) {
        return this.runlevel(0).execute(...opts)
    }
}

class Component {
    constructor() {
        this.id = this.constructor.id || -1
    }

    setup() {}
    teardown() {}
}

class System {
    constructor(recs) {
        this.queries = this.constructor.queries || {}
        this.id = this.constructor.id || -1
        this.recs = recs
    }

    setup() {}
    teardown() {}

    execute() {
        throw new Error('you forgot something...')
    }
}

class Entity {
    constructor(id, recs) {
        this.id = id
        this.recs = recs
        this.components = new Map()
    }

    addComponent(component, ...opts) {
        this.recs.registerComponent(component)
        if (this.hasComponent(component)) {
            throw new Error('already haz component')
        }

        const c = new component(...opts)
        this.components.set(c.id, c)
        this.recs.updateQueries(this)
        c.setup(...opts)
        return this
    }

    hasComponent(component) {
        return this.components.has(component.id)
    }

    getComponent(component) {
        return this.components.get(component.id)
    }

    removeComponent(component) {
        const c = this.getComponent(component)
        if (!c) {
            throw new Error('dont have that component')
        }

        this.components.delete(c.id)
        this.recs.updateQueries(this)
        c.teardown()
        return this
    }
}

class Runlevel {
    constructor(id, recs) {
        this.id = id
        this.recs = recs
        this.systems = new Map()
    }

    addSystem(system, ...opts) {
        this.recs.registerSystem(system)
        if (this.hasSystem(system)) {
            throw new Error('already haz system')
        }

        const s = new system(this.recs, ...opts)
        this.systems.set(s.id, s)
        for (const name in s.queries) {
            this.recs.createQuery(s.queries[name])
        }
        s.setup(...opts)
        return this
    }

    hasSystem(system) {
        return this.systems.has(system.id)
    }

    getSystem(system) {
        return this.systems.get(system.id)
    }

    removeSystem(system) {
        const s = this.getSystem(system)
        if (!s) {
            throw new Error('dont have that system')
        }

        this.systems.delete(s.id)
        s.teardown()
        for (const name in s.queries) {
            this.recs.removeQuery(s.queries[name])
        }
        return this
    }

    reset() {
        this.systems.forEach(s => this.removeSystem(s))
        return this
    }

    execute(...opts) {
        for (const [_, s] of this.systems) {
            if (s.execute(...opts) === false) {
                return false
            }
        }
    }
}

class Query {
    constructor(id, AND, OR, NOT) {
        this.id = id
        this.AND = AND.map(x => [x, true]).concat(NOT.map(x => [x, false]))
        this.OR = OR
        this.entities = []
    }

    test(entity) {
        let match = this.OR.length ? false : true
        for (const c of this.OR) {
            if (entity.hasComponent(c)) {
                match = true
                break
            }
        }

        if (match) {
            for (const c of this.AND) {
                if (entity.hasComponent(c[0]) !== c[1]) {
                    match = false
                    break
                }
            }
        }

        const index = this.entities.indexOf(entity)
        if (match && !~index) {
            this.entities.push(entity)
        } else if (!match && ~index) {
            this.entities.splice(index, 1)
        }
        return this
    }

    delete(entity) {
        const index = this.entities.indexOf(entity)
        if (~index) {
            this.entities.splice(index, 1)
        }
        return this
    }
}

Query.parse = function(recs, config) {
    const AND = config.AND || config.match || []
    const OR = config.OR || config.one || []
    const NOT = config.NOT || config.not || []

    AND.concat(OR, NOT).forEach(c => recs.registerComponent(c))

    const map = (s,a) => a.map(c => c.id).sort((a,b)=>a-b).map(id => s+id)
    const qid = map('+', AND).concat(map('?', OR), map('!', NOT)).join('')

    return { AND, OR, NOT, qid }
}


// ------------------------------------------------------


class Box extends Component {
    setup(w, h) {
        this.value = new Vector2(w, h)
    }
}

class Position extends Component {
    setup(x, y) {
        this.value = new Vector2(x, y)
    }
}

class Speed extends Component {
    setup(x, y) {
        this.value = new Vector2(x, y)
    }
}

class Color extends Component {
    setup(value) {
        this.value = value
    }
}

class Boundary extends System {
    setup(minX, minY, maxX, maxY) {
        this.min = new Vector2(minX, minY)
        this.max = new Vector2(maxX, maxY)
    }

    execute() {
        this.queries.boxes.results.forEach(box => {
            const size = box.getComponent(Box).value
            const pos = box.getComponent(Position).value
            const speed = box.getComponent(Speed).value

            if (
                (pos.x < this.min.x && speed.x < 0) ||
                (pos.x + size.x > this.max.x && speed.x > 0)
            ) {
                speed.x *= -1
            }

            if (
                (pos.y < this.min.y && speed.y < 0) ||
                (pos.y + size.y > this.max.y && speed.y > 0)
            ) {
                speed.y *= -1
            }
        })
    }
}

Boundary.queries = {
    boxes: { match: [Box, Position, Speed] },
}

class Moveable extends System {
    execute(delta) {
        this.queries.moveable.results.forEach(obj => {
            const speed = obj.getComponent(Speed).value
            const pos = obj.getComponent(Position).value

            Vector2.add(pos, speed.mul(delta))
        })
    }
}

Moveable.queries = {
    moveable: { match: [Position, Speed] },
}

class Render extends System {
    setup(ctx, background, defaultColor) {
        this.ctx = ctx
        this.canvas = ctx.canvas
        this.background = background || '#000'
        this.defaultColor = defaultColor || '#FFF'
    }

    execute() {
        this.ctx.fillStyle = this.background
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

        this.queries.boxes.results.forEach(box => {
            const size = box.getComponent(Box).value
            let pos = box.getComponent(Position).value
            let color = this.defaultColor

            pos = pos.map(v => Math.round(v))
            if (box.hasComponent(Color)) {
                color = box.getComponent(Color).value
            }

            ctx.fillStyle = color
            ctx.fillRect(pos.x, pos.y, size.x, size.y)
        })
    }
}

Render.queries = {
    boxes: { match: [Box, Position] },
}

const canvas = document.getElementById('example')
const ctx = canvas.getContext('2d')
canvas.width = 600
canvas.height = 400

const recs = new RECS()

recs
    .createEntity()
    .addComponent(Box, 50, 50)
    .addComponent(Position, 0, 175)
    .addComponent(Color, '#FFCC00')
    .addComponent(Speed, 150, -50)

recs
    .createEntity()
    .addComponent(Box, 30, 30)
    .addComponent(Position, 500, 100)
    .addComponent(Color, '#00B0FF')
    .addComponent(Speed, -200, 70)

recs
    .runlevel(0)
    .addSystem(Boundary, 0, 0, canvas.width, canvas.height)
    .addSystem(Moveable)

recs
    .runlevel(1)
    .addSystem(Render, ctx, '#111')

const config = {
    tickRate: 60,
    deltaScale: 1000,
    step: delta => recs.runlevel(0).execute(delta),
    render: () => recs.runlevel(1).execute(),
}

new Timer()
    .setup(config)
    .start()
