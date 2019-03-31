import os

from jinja2 import Template
from sanic import Sanic, response
import ideograph

app = Sanic()

app.static("/static", "./static")

@app.get("/")
async def main(request):
    try:
        components = request.args['components'][0]
    except KeyError:
        components = ""
    template = Template(open("form.jinja2").read())
    ideographs = [(i, "".join(sorted(ideograph.components(i)))) for i in sorted(ideograph.find(components))]
    return response.html(template.render(
        components=components,
        ideographs=ideographs
        ))

if __name__ == "__main__":
    try:
        app.run(host="0.0.0.0", port=int(os.environ.get("PORT")))
    except TypeError:
        app.run()