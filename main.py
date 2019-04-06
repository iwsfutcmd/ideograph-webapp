import os
import json
# import sqlite3
from pathlib import Path
from math import inf

import unicodedataplus as unicodedata
import redis
from jinja2 import Template
from sanic import Sanic, response
import ideograph

app = Sanic()

app.static("/static", "./static")

try:
    r = redis.from_url(os.environ.get("REDIS_URL"))
except ValueError:
    r = redis.Redis()

def stroke_sort(c):
    s = unicodedata.total_strokes(c)
    if s == 0:
        return inf
    else:
        return s

@app.get("/")
async def main(request):
    try:
        components = request.args['components'][0]
    except KeyError:
        components = ""
    for comp in components:
        r.zincrby("cmps", 1, comp)
    template = Template(open("form.jinja2").read())
    ideos = sorted(ideograph.find(components), key=stroke_sort)
    ideographs = [(i, "".join(sorted(ideograph.components(i), key=stroke_sort))) for i in ideos]
    common_components = [c.decode("utf-8") for c in r.zrevrange("cmps", 0, -1)]
    return response.html(template.render(
        components=components,
        ideographs=ideographs,
        common_components=common_components,
        ))

if __name__ == "__main__":
    try:
        app.run(host="0.0.0.0", port=int(os.environ.get("PORT")))
    except TypeError:
        app.run()