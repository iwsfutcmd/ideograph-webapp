import os
import json
from collections import Counter

import unicodedata2 as unicodedata
import redis
from jinja2 import Template
from sanic import Sanic, response
import ideograph

app = Sanic()

app.static("/static", "./static")

r = redis.Redis()
# component_counter = Counter(json.load(open("component_counter.json")))

def stroke_sort(c):
    s = unicodedata.total_strokes(c)
    if s == 0:
        return 255
    else:
        return s

@app.get("/")
async def main(request):
    try:
        components = request.args['components'][0]
    except KeyError:
        components = ""
    # component_counter.update(components)
    # json.dump(component_counter, open("component_counter.json", "w"))
    for comp in components:
        r.zincrby("cmps", 1, comp)
    template = Template(open("form.jinja2").read())
    ideos = sorted(ideograph.find(components), key=stroke_sort)
    ideographs = [(i, "".join(sorted(ideograph.components(i)))) for i in ideos]
    # common_components = [c[0] for c in component_counter.most_common()]
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