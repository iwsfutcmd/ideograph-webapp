import os
import json
from collections import Counter

from jinja2 import Template
from sanic import Sanic, response
import ideograph

app = Sanic()

app.static("/static", "./static")

component_counter = Counter(json.load(open("component_counter.json")))

@app.get("/")
async def main(request):
    try:
        components = request.args['components'][0]
    except KeyError:
        components = ""
    component_counter.update(components)
    json.dump(component_counter, open("component_counter.json", "w"))
    template = Template(open("form.jinja2").read())
    ideographs = [(i, "".join(sorted(ideograph.components(i)))) for i in sorted(ideograph.find(components))]
    common_components = [c[0] for c in component_counter.most_common()]
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