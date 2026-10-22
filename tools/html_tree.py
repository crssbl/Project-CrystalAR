"""Small read-only HTML tree for checking table and card structure."""
from html.parser import HTMLParser


class Element:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    @property
    def text(self):
        return ''.join(c if isinstance(c, str) else c.text for c in self.children)

    def find(self, tag=None, **attrs):
        result = []
        for child in self.children:
            if isinstance(child, str):
                continue
            if (tag is None or child.tag == tag) and all(
                    (value in child.attrs.get(key, '').split() if key == 'class'
                     else child.attrs.get(key) == value) for key, value in attrs.items()):
                result.append(child)
            result.extend(child.find(tag, **attrs))
        return result


class Tree(HTMLParser):
    VOID = set('area base br col embed hr img input link meta param source track wbr'.split())

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Element()
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)
