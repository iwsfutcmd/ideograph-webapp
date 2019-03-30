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
    ideographs = [(i, "%X" % ord(i)) for i in sorted(ideograph.find(components))]
    return response.html(template.render(
        components=components,
        ideographs=ideographs
        ))

@app.route("/<components>")
async def lookup(request, components):
    ideographs = ideograph.find(components)
    return response.text("".join(ideographs))

if __name__ == "__main__":
    app.run(port=33507)
    # app.run()